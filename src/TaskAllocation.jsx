// taskAllocation.jsx
import { Field, Form, Formik } from "formik";
import React, { useEffect, useState } from "react";
import "./App.css";
import {
  adjustValue,
  applyGlobalAddLogic, // used for N per User mode only
  calcEffectivePool,
  calcTotals,
  calcUpdatedUsers,
  disableSelect,
} from "./TaskAllocationHelpers";

// Inlined constants object
const CONSTANTS = {
  FIELD_KEYS: {
    TO_ASSIGN: "toAssign",
    ACTION: "action",
    ALLOCATION_MODE: "allocationMode",
    GLOBAL_ADD_MODE: "globalAddMode",
    QUALIFIER: "qualifier",
    QUALIFIER_LOCKED: "qualifierLocked",
  },
  ALLOCATION_MODES: {
    NORMAL: "normal",
    DISTRIBUTED: "distributed",
  },
  USER_ACTIONS: {
    ADD: "add",
    SUBTRACT: "subtract",
    EXCLUDE: "exclude",
  },
  CONSOLIDATED_MODES: {
    DISTRIBUTED_EVEN: "evenly",
    DISTRIBUTED_N: "perUser",
  },
};

const FIELD_NAMES = {
  TO_ASSIGN: "Change Amount",
  ACTION: "Action",
  ALLOCATION_MODE: "Allocation Mode",
  GLOBAL_ADD_MODE: "Global Add Mode",
  QUALIFIER: "Percent (%)",
  QUALIFIER_LOCKED: "Qualifier Locked",
  PER_USER_CHUNK: "Per User Chunk",
  GLOBAL_CHUNK: "Global Chunk",
  APPLIED_GLOBAL_CHUNK: "Applied Global Chunk",
  APPLIED_PER_USER_CHUNK: "Applied Per",
  TOTAL_ADDED: "Total Added",
  TOTAL_SUBTRACTED: "Total Subtracted",
  TOTAL_ALLOCATED: "Total Allocated",
  PENDING_TOTAL: "Pending Total",
  REMAINING: "Remaining",
  CURRENT_TASKS: "Current Tasks",
  PERCENT: "Percent (%)",
  CHANGE_AMOUNT: "Change Amount",
};

// Add new keys for qualifier fields.
CONSTANTS.FIELD_KEYS.QUALIFIER = "qualifier";
CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED = "qualifierLocked";

// Consolidated modes constant.
const CONSOLIDATED_MODES = CONSTANTS.CONSOLIDATED_MODES;

/* ---------------- Helper Modules ---------------- */

const CumulativePercent = {
  recalc: (values, setFieldValue) => {
    const lockedArr = values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED];
    const totalExplicit = values[CONSTANTS.FIELD_KEYS.QUALIFIER].reduce(
      (sum, q, i) => {
        if (
          values[CONSTANTS.FIELD_KEYS.ACTION][i] ===
          CONSTANTS.USER_ACTIONS.EXCLUDE
        )
          return sum;
        return sum + (lockedArr[i] ? Number(q) : 0);
      },
      0
    );
    const unlockedIndices = lockedArr
      .map((locked, i) =>
        !locked &&
        values[CONSTANTS.FIELD_KEYS.ACTION][i] !==
          CONSTANTS.USER_ACTIONS.EXCLUDE
          ? i
          : null
      )
      .filter((i) => i !== null);
    const countUnlocked = unlockedIndices.length;
    if (countUnlocked === 0) return;
    const remaining = 100 - totalExplicit;
    const baseValue = Math.floor(remaining / countUnlocked);
    let extraCount = remaining % countUnlocked;
    if (extraCount < unlockedIndices.length) extraCount = 0;
    unlockedIndices.forEach((i, idx) => {
      const newValue = baseValue + (idx < extraCount ? 1 : 0);
      setFieldValue(`${CONSTANTS.FIELD_KEYS.QUALIFIER}[${i}]`, newValue);
    });
  },
  clampValue: (values, idx, candidate) => {
    if (
      values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
      CONSTANTS.USER_ACTIONS.EXCLUDE
    )
      return 0;
    const otherExplicitSum = values[CONSTANTS.FIELD_KEYS.QUALIFIER].reduce(
      (sum, q, i) => {
        if (i === idx) return sum;
        if (
          values[CONSTANTS.FIELD_KEYS.ACTION][i] ===
          CONSTANTS.USER_ACTIONS.EXCLUDE
        )
          return sum;
        return (
          sum +
          (values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][i] ? Number(q) : 0)
        );
      },
      0
    );
    const available = Math.max(0, 100 - otherExplicitSum);
    return Math.floor(Math.max(0, Math.min(available, candidate)));
  },
};

const recalcNPerUser = (
  values,
  setFieldValue,
  baseAssignable,
  perUserChunk
) => {
  const nonExcludedIndices = values[CONSTANTS.FIELD_KEYS.ACTION]
    .map((act, i) => (act === CONSTANTS.USER_ACTIONS.ADD ? i : null))
    .filter((i) => i !== null);
  const count = nonExcludedIndices.length;
  if (count === 0) {
    setFieldValue(
      CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      values[CONSTANTS.FIELD_KEYS.TO_ASSIGN].map(() => 0)
    );
    return;
  }
  let remainingPool = baseAssignable;
  const newAllocations = values[CONSTANTS.FIELD_KEYS.TO_ASSIGN].map(() => 0);
  for (let i = 0; i < nonExcludedIndices.length; i++) {
    const idx = nonExcludedIndices[i];
    if (remainingPool <= 0) {
      newAllocations[idx] = 0;
    } else if (remainingPool >= perUserChunk) {
      newAllocations[idx] = perUserChunk;
      remainingPool -= perUserChunk;
    } else {
      newAllocations[idx] = remainingPool;
      remainingPool = 0;
    }
  }
  setFieldValue(CONSTANTS.FIELD_KEYS.TO_ASSIGN, newAllocations);
};

/* ---------------- Controlled Input Component ---------------- */

// When an action is "exclude" we want to display an indeterminate field.
// We pass a new prop "isExcluded" to indicate that.
const ControlledToAssignInput = ({
  field,
  form,
  index,
  onValidatedChange,
  readOnly,
  style,
  isExcluded,
}) => {
  // If the action is excluded, show a read-only text field with "Indeterminate"

  const [internalValue, setInternalValue] = useState(field.value);
  useEffect(() => {
    setInternalValue(field.value);
  }, [field.value]);
  const handleChange = (e) => {
    onValidatedChange(e, index, form.values, form.setFieldValue);
  };
  return (
    <input
      type="number"
      {...field}
      name={field.name}
      value={isExcluded ? "0" : internalValue}
      onChange={handleChange}
      readOnly={readOnly}
      style={style}
    />
  );
};

/* ---------------- Branch Components ---------------- */

const NormalAllocationForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
  isLoaded,
}) => {
  const { values, setFieldValue } = formikProps;
  const totals = calcTotals(values);
  return (
    <table className="table">
      <thead>
        <tr>
          <th className="th">User</th>
          <th className="th ws-wrap-down">{FIELD_NAMES.CURRENT_TASKS}</th>
          <th className="th">{FIELD_NAMES.ACTION}</th>
          <th className="th ws-wrap-down">{FIELD_NAMES.CHANGE_AMOUNT}</th>
          <th className="th">{FIELD_NAMES.REMAINING}</th>
          <th className="th">{FIELD_NAMES.PENDING_TOTAL}</th>
        </tr>
      </thead>
      <tbody>
        {(!isLoaded && (
          <tr>
            <td colSpan={67} className="td">
              Loading...
            </td>
          </tr>
        )) ||
          users.map((user, idx) => {
            const currentVal = Number(
              values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
            );
            let remaining = 0;
            if (
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.ADD
            ) {
              const poolForAddition = baseAssignable;
              const addMax = Math.max(
                0,
                poolForAddition - (totals.totalAdded - currentVal)
              );
              remaining = Math.max(0, addMax - currentVal);
            } else if (
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.SUBTRACT
            ) {
              remaining = user.tasks - currentVal;
            }
            const pendingTotal =
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.ADD
                ? user.tasks + currentVal
                : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                  CONSTANTS.USER_ACTIONS.SUBTRACT
                ? Math.max(0, user.tasks - currentVal)
                : user.tasks;
            return (
              <tr key={user.id}>
                <td className="td">{user.name}</td>
                <td className="td">{user.tasks}</td>
                <td className="td">
                  <Field
                    as="select"
                    name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}][${
                      values[CONSTANTS.FIELD_KEYS.ACTION][idx]
                    }]`}
                    value={values[CONSTANTS.FIELD_KEYS.ACTION][idx]}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setFieldValue(
                        `${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`,
                        newValue
                      );
                      if (newValue === CONSTANTS.USER_ACTIONS.EXCLUDE) {
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                          0
                        );
                      }
                    }}
                    disabled={disableSelect(
                      values,
                      idx,
                      totals,
                      baseAssignable,
                      user.tasks
                    )}
                  >
                    <option value={CONSTANTS.USER_ACTIONS.ADD}>Add</option>
                    <option value={CONSTANTS.USER_ACTIONS.SUBTRACT}>
                      Reassign
                    </option>
                  </Field>
                </td>
                <td className="td">
                  <Field
                    name={`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                    component={ControlledToAssignInput}
                    index={idx}
                    onValidatedChange={handleFieldChange}
                    readOnly={false}
                  />
                </td>
                <td className="td">
                  <button
                    type="button"
                    onClick={() =>
                      setFieldValue(
                        `${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                        Number(
                          values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
                        ) + remaining
                      )
                    }
                    className="button number"
                  >
                    {remaining}
                  </button>
                </td>
                <td className="td">{pendingTotal}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
};

/**
 * DistributedEvenForm renders the UI for Distributed Evenly mode.
 * In this version we use a new appliedGlobalChunk field (updated only via the button)
 * for distribution. Its value resets to 0 on submit.
 */
const DistributedEvenForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
  isLoaded,
}) => {
  const { values, setFieldValue } = formikProps;

  // Function for when explicit percentages sum to less than 100%
  const consolidateValuesBelow100 = (vals, pool) => {
    const { ACTION, QUALIFIER, QUALIFIER_LOCKED, TO_ASSIGN } =
      CONSTANTS.FIELD_KEYS;
    const actions = vals[ACTION];
    const origQuals = vals[QUALIFIER];
    const origLocks = vals[QUALIFIER_LOCKED];

    // 1. Forced qualifiers: if a field is excluded, its percentage becomes 0.
    const forcedQuals = origQuals.map((q, i) =>
      actions[i] === CONSTANTS.USER_ACTIONS.EXCLUDE ? 0 : q
    );

    // 2. Identify explicit fields: those that are locked and have percent > 0.
    const explicitFields = origQuals
      .map((q, i) => ({ index: i, percent: q }))
      .filter(
        ({ index, percent }) =>
          actions[index] !== CONSTANTS.USER_ACTIONS.EXCLUDE &&
          origLocks[index] &&
          percent > 0
      )
      .sort((a, b) => b.percent - a.percent);

    // Identify implicit fields: those that are not locked.
    const implicitIndices = origQuals
      .map((q, i) => i)
      .filter(
        (i) => actions[i] !== CONSTANTS.USER_ACTIONS.EXCLUDE && !origLocks[i]
      );

    // Identify excluded explicit fields: locked with percent === 0.
    const excludedIndices = origQuals
      .map((q, i) => ({ index: i, percent: q }))
      .filter(
        ({ index, percent }) =>
          actions[index] !== CONSTANTS.USER_ACTIONS.EXCLUDE &&
          origLocks[index] &&
          percent === 0
      )
      .map(({ index }) => index);

    // 3. Compute total explicit percentage.
    const totalExplicitPercent = explicitFields.reduce(
      (sum, f) => sum + forcedQuals[f.index],
      0
    );

    // --- Branch B: When explicit totals are 100% or more ---
    if (totalExplicitPercent >= 100) {
      // For each explicit field, compute ideal allocation from full pool:
      // ideal = (forcedQuals[i]/100)*pool, initial = floor(ideal) bumped to at least 1 if ideal > 0.
      const explicitDistribution = explicitFields.reduce((acc, f) => {
        const ideal = (forcedQuals[f.index] / 100) * pool;
        const initial = ideal > 0 ? Math.max(1, Math.floor(ideal)) : 0;
        acc[f.index] = initial;
        return acc;
      }, {});
      // Build final distribution: explicit fields get computed values; implicit and excluded fields get 0.
      const finalDist = new Array(origQuals.length).fill(0);
      explicitFields.forEach((f) => {
        finalDist[f.index] = explicitDistribution[f.index];
      });
      implicitIndices.forEach((i) => {
        finalDist[i] = 0;
      });
      excludedIndices.forEach((i) => {
        finalDist[i] = 0;
      });
      return { ...vals, [TO_ASSIGN]: finalDist };
    }

    // --- Branch A: When total explicit percentage is less than 100% ---
    // Reserve one task for each implicit field.
    const reservedForImplicit =
      pool > implicitIndices.length ? 0 : implicitIndices.length;
    const availableExplicitPool = pool - reservedForImplicit;

    // For each explicit field, compute its ideal allocation against the available explicit pool.
    // ideal = (forcedQuals[i] / 100) * availableExplicitPool.
    // initial = if ideal > 0 then max(1, floor(ideal)) else 0.
    // cap = Math.ceil(ideal).
    const explicitAllocations = explicitFields.map((f) => {
      const ideal = (forcedQuals[f.index] / 100) * availableExplicitPool;
      const initial = ideal > 0 ? Math.max(1, Math.floor(ideal)) : 0;
      const cap = Math.ceil(ideal);
      return { index: f.index, ideal, initial, cap, allocation: initial };
    });

    // Sum explicit allocations and compute leftover from the available explicit pool.
    const explicitTotal = explicitAllocations.reduce(
      (sum, a) => sum + a.allocation,
      0
    );
    let leftover = availableExplicitPool - explicitTotal;

    // If leftover is less than the number of implicit fields,
    // adjust explicit allocations by removing tasks from those with allocation > 1 in round-robin descending order.
    const adjustForImplicit = (allocs, currentLeftover, needed) =>
      currentLeftover >= needed
        ? allocs
        : (() => {
            const candidates = allocs.filter((a) => a.allocation > 1);
            if (candidates.length === 0) return allocs;
            const sorted = candidates.sort(
              (a, b) => b.allocation - a.allocation
            );
            const candidate = sorted[0];
            const updated = allocs.map((a) =>
              a.index === candidate.index
                ? { ...a, allocation: a.allocation - 1 }
                : a
            );
            return adjustForImplicit(updated, currentLeftover + 1, needed);
          })();
    if (implicitIndices.length > 0 && leftover < implicitIndices.length) {
      const needed = implicitIndices.length - leftover;
      const adjustedExplicit = adjustForImplicit(
        explicitAllocations,
        leftover,
        implicitIndices.length
      );
      const newExplicitTotal = adjustedExplicit.reduce(
        (s, a) => s + a.allocation,
        0
      );
      leftover = pool - reservedForImplicit - newExplicitTotal;
      // Overwrite explicitAllocations with adjusted values.
      adjustedExplicit.forEach((a, idx) => {
        explicitAllocations[idx] = a;
      });
    }

    // Cap explicit fields: final allocation = min(allocation, cap).
    const explicitDistribution = explicitAllocations.reduce((acc, a) => {
      acc[a.index] = Math.min(a.allocation, a.cap);
      return acc;
    }, {});

    // Build the final distribution array.
    let finalDist = new Array(origQuals.length).fill(0);
    explicitFields.forEach((f) => {
      finalDist[f.index] = explicitDistribution[f.index];
    });
    excludedIndices.forEach((i) => {
      finalDist[i] = 0;
    });

    // Distribute leftover evenly among implicit fields by averaging.
    if (implicitIndices.length > 0 && leftover > 0) {
      const count = implicitIndices.length;
      const avg = Math.floor(leftover / count);
      const rem = leftover % count;
      const implicitDistribution = implicitIndices.map(
        (i, idx) => avg + (idx < rem ? 1 : 0)
      );
      implicitIndices.forEach((i, idx) => {
        finalDist[i] = implicitDistribution[idx];
      });
      leftover = 0;
    } else {
      implicitIndices.forEach((i) => (finalDist[i] = 0));
    }

    return { ...vals, [TO_ASSIGN]: finalDist };
  };

  const consolidateValuesAt100 = (vals, pool) => {
    const { ACTION, QUALIFIER, QUALIFIER_LOCKED, TO_ASSIGN } =
      CONSTANTS.FIELD_KEYS;
    const actions = vals[ACTION];
    const origQuals = vals[QUALIFIER];
    const origLocks = vals[QUALIFIER_LOCKED];

    // For fields that are not excluded, use their locked value; otherwise, force 0.
    const forcedQuals = origQuals.map((q, i) =>
      actions[i] === CONSTANTS.USER_ACTIONS.EXCLUDE ? 0 : q
    );

    // Identify explicit (locked) fields that have a positive percentage.
    const explicitFields = origQuals
      .map((q, i) => ({ index: i, percent: q }))
      .filter(
        ({ index, percent }) =>
          actions[index] !== CONSTANTS.USER_ACTIONS.EXCLUDE &&
          origLocks[index] &&
          percent > 0
      );

    const availableExplicitPool = pool; // use the full pool
    if (explicitFields.length === 0) {
      return { ...vals, [TO_ASSIGN]: new Array(origQuals.length).fill(0) };
    }

    // Compute the ideal allocation for each explicit field strictly by percentage.
    // No forced minimum is applied here.
    const explicitAllocations = explicitFields.map((f) => {
      const ideal = (forcedQuals[f.index] / 100) * availableExplicitPool;
      const initial = Math.floor(ideal);
      const cap = Math.ceil(ideal);
      return {
        index: f.index,
        ideal,
        initial,
        cap,
        remainder: ideal - initial,
      };
    });

    // Sum the initial allocations.
    let totalAllocated = explicitAllocations.reduce(
      (sum, a) => sum + a.initial,
      0
    );
    let leftover = availableExplicitPool - totalAllocated;

    // Distribute any leftover tasks based on the highest remainder
    explicitAllocations.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < leftover; i++) {
      explicitAllocations[i % explicitAllocations.length].initial++;
    }

    // Build the final distribution array.
    let finalDist = new Array(origQuals.length).fill(0);
    explicitAllocations.forEach((f) => {
      finalDist[f.index] = f.initial;
    });
    finalDist = finalDist.map((v) => (isNaN(v) ? 0 : v));

    return { ...vals, [TO_ASSIGN]: finalDist };
  };

  const consolidateValues = (vals, pool) => {
    const { ACTION, QUALIFIER, QUALIFIER_LOCKED } = CONSTANTS.FIELD_KEYS;
    const actions = vals[ACTION];
    const origQuals = vals[QUALIFIER];
    const origLocks = vals[QUALIFIER_LOCKED];

    const forcedQuals = origQuals.map((q, i) =>
      actions[i] === CONSTANTS.USER_ACTIONS.EXCLUDE ? 0 : q
    );

    const explicitFields = origQuals
      .map((q, i) => ({ index: i, percent: q }))
      .filter(
        ({ index, percent }) =>
          actions[index] !== CONSTANTS.USER_ACTIONS.EXCLUDE &&
          origLocks[index] &&
          percent > 0
      );

    const totalExplicitPercent = explicitFields.reduce(
      (sum, f) => sum + forcedQuals[f.index],
      0
    );

    let result =
      totalExplicitPercent >= 100
        ? consolidateValuesAt100(vals, pool)
        : consolidateValuesBelow100(vals, pool);

    // Ensure the TO_ASSIGN array does not contain NaN values
    result[CONSTANTS.FIELD_KEYS.TO_ASSIGN] = result[
      CONSTANTS.FIELD_KEYS.TO_ASSIGN
    ].map((v) => (isNaN(v) ? 0 : v));

    return result;
  };

  const updateDistribution = (updatedValues, pool) => {
    const consolidated = consolidateValues(updatedValues, pool);
    setFieldValue(
      CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      consolidated[CONSTANTS.FIELD_KEYS.TO_ASSIGN]
    );
  };

  const handleQualifierChange = (e, idx) => {
    const newCandidate = Number(e.target.value) || 0;
    const clamped = CumulativePercent.clampValue(values, idx, newCandidate);
    setFieldValue(`${CONSTANTS.FIELD_KEYS.QUALIFIER}[${idx}]`, clamped);
    setFieldValue(`${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`, true);
    const updatedQualifiers = values[CONSTANTS.FIELD_KEYS.QUALIFIER].map(
      (q, i) => (i === idx ? clamped : q)
    );
    const updatedValues = {
      ...values,
      [CONSTANTS.FIELD_KEYS.QUALIFIER]: updatedQualifiers,
    };
    CumulativePercent.recalc(updatedValues, setFieldValue);
    if (Number(values.appliedGlobalChunk) > 0) {
      updateDistribution(updatedValues, Number(values.appliedGlobalChunk));
    }
  };

  useEffect(() => {
    let value = Number(values.globalChunk);
    if (isNaN(value) || value < 0) {
      value = 0;
    } else if (value > baseAssignable) {
      value = baseAssignable;
    }
    if (value !== Number(values.globalChunk)) {
      setFieldValue("globalChunk", value);
    }
  }, [values.globalChunk, baseAssignable, setFieldValue]);

  const reacalculateAllValues = () => {
    const updatedValues = {
      ...values,
      [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: values[
        CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED
      ].map(() => false),
    };
    CumulativePercent.recalc(updatedValues, setFieldValue);
  };

  useEffect(() => {
    reacalculateAllValues();
  }, []);

  const updateConsolidatedValues = () => {
    const newPool = Number(values.globalChunk);
    setFieldValue("appliedGlobalChunk", newPool);
    updateDistribution(values, newPool);
  };

  const totals = calcTotals(values);
  return (
    <>
      <div className="section">
        <label className="label">
          Global Chunk (Cap per User):
          <Field
            type="number"
            name="globalChunk"
            min="0"
            max={baseAssignable}
            onChange={(e) => {
              let value = Number(e.target.value);
              if (isNaN(value)) value = 0;
              if (value < 0) value = 0;
              if (value > baseAssignable) value = baseAssignable;
              setFieldValue("globalChunk", value);
            }}
          />
        </label>
        <button
          type="button"
          onClick={updateConsolidatedValues}
          className="button"
          disabled={
            Number(values.globalChunk) === Number(values.appliedGlobalChunk)
          }
        >
          Apply {values.globalChunk} &rArr; {values.appliedGlobalChunk}
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="th">User</th>
            <th className="th ws-wrap-down">{FIELD_NAMES.CURRENT_TASKS}</th>
            <th className="th">{FIELD_NAMES.ACTION}</th>
            <th className="th">{FIELD_NAMES.PERCENT}</th>
            <th className="th ws-wrap-down">{FIELD_NAMES.CHANGE_AMOUNT}</th>
            <th className="th">{FIELD_NAMES.PENDING_TOTAL}</th>
          </tr>
        </thead>
        <tbody>
          {(!isLoaded && (
            <tr>
              <td colSpan={67} className="td">
                Loading...
              </td>
            </tr>
          )) ||
            users.map((user, idx) => {
              const currentVal = Number(
                values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
              );
              let remaining = 0;
              if (
                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                CONSTANTS.USER_ACTIONS.ADD
              ) {
                const poolForAddition = Number(values.appliedGlobalChunk);
                const addMax = Math.max(
                  0,
                  poolForAddition - (totals.totalAdded - currentVal)
                );
                remaining = Math.max(0, addMax - currentVal);
              } else if (
                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                CONSTANTS.USER_ACTIONS.SUBTRACT
              ) {
                remaining = user.tasks - currentVal;
              }
              const pendingTotal =
                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                CONSTANTS.USER_ACTIONS.ADD
                  ? user.tasks + currentVal
                  : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                    CONSTANTS.USER_ACTIONS.SUBTRACT
                  ? Math.max(0, user.tasks - currentVal)
                  : user.tasks;

              const qualifierValue =
                Number(values[CONSTANTS.FIELD_KEYS.QUALIFIER][idx]) || 0;
              const totalExplicitSum = values[
                CONSTANTS.FIELD_KEYS.QUALIFIER
              ].reduce(
                (sum, q, i) =>
                  values[CONSTANTS.FIELD_KEYS.ACTION][i] !==
                    CONSTANTS.USER_ACTIONS.EXCLUDE &&
                  values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][i]
                    ? sum + Number(q)
                    : sum,
                0
              );
              const remPercentVal = Math.max(0, 100 - totalExplicitSum);
              const computedValue = values[
                CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED
              ][idx]
                ? qualifierValue
                : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                  CONSTANTS.USER_ACTIONS.EXCLUDE
                ? 0
                : qualifierValue < 1 && remPercentVal > 0
                ? ""
                : qualifierValue;
              return (
                <tr key={user.id}>
                  <td className="td">{user.name}</td>
                  <td className="td">{user.tasks}</td>
                  <td className="td">
                    <Field
                      as="select"
                      name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}][${
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx]
                      }]`}
                      value={values[CONSTANTS.FIELD_KEYS.ACTION][idx]}
                      onChange={(e) => {
                        const newValue = e.target.value;

                        // Define initial row state based on newValue
                        const rowStates = {
                          [CONSTANTS.USER_ACTIONS.EXCLUDE]: {
                            action: CONSTANTS.USER_ACTIONS.EXCLUDE,
                            toAssign: 0,
                            qualifier: 0,
                            qualifierLocked: true,
                          },
                          [CONSTANTS.USER_ACTIONS.ADD]: {
                            action: CONSTANTS.USER_ACTIONS.ADD,
                            toAssign: 0,
                            qualifier: 0,
                            qualifierLocked: false,
                          },
                        };

                        const initialRowState = rowStates[newValue] || {};

                        // Apply initial row state
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`,
                          newValue
                        );
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                          initialRowState.toAssign
                        );
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.QUALIFIER}[${idx}]`,
                          initialRowState.qualifier
                        );
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                          initialRowState.qualifierLocked
                        );

                        // Update values for recalculating distribution
                        const updatedValues = {
                          ...values,
                          [CONSTANTS.FIELD_KEYS.ACTION]: values[
                            CONSTANTS.FIELD_KEYS.ACTION
                          ].map((act, i) =>
                            i === idx ? initialRowState.action : act
                          ),
                          [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: values[
                            CONSTANTS.FIELD_KEYS.TO_ASSIGN
                          ].map((assign, i) =>
                            i === idx ? initialRowState.toAssign : assign
                          ),
                          [CONSTANTS.FIELD_KEYS.QUALIFIER]: values[
                            CONSTANTS.FIELD_KEYS.QUALIFIER
                          ].map((q, i) =>
                            i === idx ? initialRowState.qualifier : q
                          ),
                          [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: values[
                            CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED
                          ].map((locked, i) =>
                            i === idx ? initialRowState.qualifierLocked : locked
                          ),
                        };

                        // Recalculate everything like a fresh state
                        CumulativePercent.recalc(updatedValues, setFieldValue);

                        // If global allocation was applied, reapply it
                        if (Number(values.appliedGlobalChunk) > 0) {
                          updateDistribution(
                            updatedValues,
                            Number(values.appliedGlobalChunk)
                          );
                        }
                      }}
                      disabled={disableSelect(
                        values,
                        idx,
                        totals,
                        baseAssignable,
                        user.tasks
                      )}
                    >
                      <option value={CONSTANTS.USER_ACTIONS.ADD}>Add</option>
                      <option value={CONSTANTS.USER_ACTIONS.EXCLUDE}>
                        Exclude
                      </option>
                    </Field>
                  </td>
                  <td className="td">
                    <div>
                      <div className="qualifierInputContainer">
                        <Field
                          name={`${CONSTANTS.FIELD_KEYS.QUALIFIER}[${idx}]`}
                          type="number"
                          disabled={
                            values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                            CONSTANTS.USER_ACTIONS.EXCLUDE
                          }
                          onChange={(e) => handleQualifierChange(e, idx)}
                          value={
                            values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]
                              ? computedValue
                              : ""
                          }
                          placeholder={
                            values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                            CONSTANTS.USER_ACTIONS.EXCLUDE
                              ? "0"
                              : !values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][
                                  idx
                                ]
                              ? qualifierValue < 1 && remPercentVal > 0
                                ? "0<"
                                : computedValue
                              : ""
                          }
                          readOnly={
                            values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                            CONSTANTS.USER_ACTIONS.EXCLUDE
                          }
                        />
                      </div>

                      <Field
                        name={`${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`}
                      >
                        {({ field }) => (
                          <div className="checkbox-container">
                            <input
                              {...field}
                              type="checkbox"
                              checked={
                                values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][
                                  idx
                                ]
                              }
                              className={
                                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                                CONSTANTS.USER_ACTIONS.ADD
                                  ? "custom-checkbox"
                                  : ""
                              }
                              disabled={
                                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                                CONSTANTS.USER_ACTIONS.EXCLUDE
                              }
                              ref={(input) => {
                                if (input) {
                                  input.indeterminate =
                                    values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                                    CONSTANTS.USER_ACTIONS.EXCLUDE;
                                }
                              }}
                              onChange={(e) => {
                                const newLocked = e.target.checked;
                                setFieldValue(
                                  `${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                                  newLocked
                                );
                                const updatedValues = {
                                  ...values,
                                  [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]:
                                    values[
                                      CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED
                                    ].map((val, i) =>
                                      i === idx ? newLocked : val
                                    ),
                                  [CONSTANTS.FIELD_KEYS.QUALIFIER]: values[
                                    CONSTANTS.FIELD_KEYS.QUALIFIER
                                  ].map((q, i) =>
                                    i === idx ? (newLocked ? q : 0) : q
                                  ),
                                };
                                CumulativePercent.recalc(
                                  updatedValues,
                                  setFieldValue
                                );
                                updateDistribution(
                                  updatedValues,
                                  Number(values.appliedGlobalChunk)
                                );
                              }}
                            />
                          </div>
                        )}
                      </Field>
                    </div>
                  </td>

                  <td className="td">
                    <Field
                      name={
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                        CONSTANTS.USER_ACTIONS.EXCLUDE
                          ? `exclude[${idx}]`
                          : `toAssign[${idx}]`
                      }
                      isExcluded={
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                        CONSTANTS.USER_ACTIONS.EXCLUDE
                      }
                      component={ControlledToAssignInput}
                      index={idx}
                      onValidatedChange={handleFieldChange}
                      readOnly={true}
                    />
                  </td>
                  <td className="td">{pendingTotal}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </>
  );
};

const NPerUserForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
  isLoaded,
}) => {
  const { values, setFieldValue } = formikProps;
  const totals = calcTotals(values);

  // On mount, force the proxy to 0.
  useEffect(() => {
    setFieldValue("appliedPerUserChunk", 0);
  }, [setFieldValue]);

  // The proxy snapshot value for the per-user cap.
  const appliedPerUserCap = Number(values.appliedPerUserChunk) || 0;

  // When "Apply Global Add" is clicked, update the proxy and allocations.
  const updateAppliedPerUserChunk = () => {
    // Commit the current perUserChunk
    setFieldValue("appliedPerUserChunk", values.perUserChunk);
    // Update the entire toAssign array using the committed value
    setFieldValue(
      CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      applyGlobalAddLogic(
        { ...values, appliedPerUserChunk: values.perUserChunk },
        baseAssignable,
        values.perUserChunk
      )
    );
  };

  return (
    <>
      <div className="section">
        <label className="label">
          Per User Chunk:
          <Field
            type="number"
            name="perUserChunk"
            // Clamp the perUserChunk between 0 and baseAssignable
            onChange={(e) => {
              let newChunk = Number(e.target.value);
              if (isNaN(newChunk) || newChunk < 0) newChunk = 0;
              if (newChunk > baseAssignable) newChunk = baseAssignable;

              // Store new per-user chunk WITHOUT applying changes
              setFieldValue("perUserChunk", newChunk);
            }}
          />
        </label>
        <button
          type="button"
          onClick={updateAppliedPerUserChunk}
          className="button"
          disabled={
            Number(values.perUserChunk) === Number(values.appliedPerUserChunk)
          }
        >
          Apply {values.perUserChunk} &rArr; {values.appliedPerUserChunk}
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="th">User</th>
            <th className="th ws-wrap-down">{FIELD_NAMES.CURRENT_TASKS}</th>
            <th className="th">{FIELD_NAMES.ACTION}</th>
            <th className="th ws-wrap-down">{FIELD_NAMES.CHANGE_AMOUNT}</th>
            <th className="th">{FIELD_NAMES.PENDING_TOTAL}</th>
          </tr>
        </thead>
        <tbody>
          {(!isLoaded && (
            <tr>
              <td colSpan={67} className="td">
                Loading...
              </td>
            </tr>
          )) ||
            users.map((user, idx) => {
              const currentVal = Number(
                values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
              );
              const pendingTotal =
                values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                CONSTANTS.USER_ACTIONS.ADD
                  ? user.tasks + currentVal
                  : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                    CONSTANTS.USER_ACTIONS.SUBTRACT
                  ? Math.max(0, user.tasks - currentVal)
                  : user.tasks;
              return (
                <tr key={user.id}>
                  <td className="td">{user.name}</td>
                  <td className="td">{user.tasks}</td>
                  <td className="td">
                    <Field
                      as="select"
                      name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}][${
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx]
                      }]`}
                      value={values[CONSTANTS.FIELD_KEYS.ACTION][idx]}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`,
                          newValue
                        );

                        // Build an updated snapshot for actions without modifying perUserChunk:
                        const updatedValues = {
                          ...values,
                          [CONSTANTS.FIELD_KEYS.ACTION]: values[
                            CONSTANTS.FIELD_KEYS.ACTION
                          ].map((act, i) => (i === idx ? newValue : act)),
                        };

                        // Force the snapshot to use the committed appliedPerUserChunk instead of the live perUserChunk.
                        const lockedValues = {
                          ...updatedValues,
                          perUserChunk: values.appliedPerUserChunk,
                          appliedPerUserChunk: values.appliedPerUserChunk,
                        };

                        const actionHandlers = {
                          [CONSTANTS.USER_ACTIONS.EXCLUDE]: () => {
                            // For Exclude, set the current row to 0 and recalc globally
                            const newArr = [
                              ...values[CONSTANTS.FIELD_KEYS.TO_ASSIGN],
                            ];
                            newArr[idx] = 0;
                            setFieldValue(
                              CONSTANTS.FIELD_KEYS.TO_ASSIGN,
                              newArr
                            );
                            recalcNPerUser(
                              { ...lockedValues },
                              setFieldValue,
                              baseAssignable,
                              values.appliedPerUserChunk
                            );
                          },

                          [CONSTANTS.USER_ACTIONS.ADD]: () => {
                            const newArr = [
                              ...values[CONSTANTS.FIELD_KEYS.TO_ASSIGN],
                            ];
                            if (values.appliedPerUserChunk === 0) {
                              newArr[idx] = 0;
                            } else {
                              // Use lockedValues so that any reference to perUserChunk is now the committed value.
                              const updatedToAssign = applyGlobalAddLogic(
                                lockedValues,
                                baseAssignable,
                                values.appliedPerUserChunk
                              );
                              newArr[idx] = updatedToAssign[idx];
                            }
                            setFieldValue(
                              CONSTANTS.FIELD_KEYS.TO_ASSIGN,
                              newArr
                            );
                          },
                        };

                        actionHandlers[newValue]?.();
                      }}
                      disabled={disableSelect(
                        values,
                        idx,
                        totals,
                        baseAssignable,
                        user.tasks
                      )}
                    >
                      <option value={CONSTANTS.USER_ACTIONS.ADD}>Add</option>
                      <option value={CONSTANTS.USER_ACTIONS.EXCLUDE}>
                        Exclude
                      </option>
                    </Field>
                  </td>
                  <td className="td">
                    <Field
                      name={
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                        CONSTANTS.USER_ACTIONS.EXCLUDE
                          ? `exclude[${idx}]`
                          : `toAssign[${idx}]`
                      }
                      isExcluded={
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                        CONSTANTS.USER_ACTIONS.EXCLUDE
                      }
                      component={ControlledToAssignInput}
                      index={idx}
                      onValidatedChange={handleFieldChange}
                      readOnly={true}
                    />
                  </td>
                  <td className="td">{pendingTotal}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </>
  );
};

const TaskAllocationForm = ({ initialStore, onUpdateInitialStore }) => {
  const safeInitialStore = {
    assignableTasks: initialStore.assignableTasks ?? 20,
    users: initialStore.users ?? [],
    isLoaded: initialStore.isLoaded ?? true,
  };

  const [assignable, setAssignable] = useState(
    safeInitialStore.assignableTasks
  );
  const [isLoaded, setIsLoaded] = useState(safeInitialStore.isLoaded);
  const [users, setUsers] = useState(safeInitialStore.users);

  useEffect(() => {
    setAssignable(safeInitialStore.assignableTasks);
    setUsers(safeInitialStore.users);
    setIsLoaded(safeInitialStore.isLoaded);
  }, [
    initialStore,
    safeInitialStore.assignableTasks,
    safeInitialStore.users,
    safeInitialStore.isLoaded,
  ]);

  const baseAssignable = assignable;

  const handleFieldChange = (e, idx, values, setFieldValue) => {
    const action = values[CONSTANTS.FIELD_KEYS.ACTION][idx];
    const { value } = e.target;
    const numericValue = parseFloat(value);
    const newValRaw = isNaN(numericValue) ? 0 : Math.max(0, numericValue);
    const oldVal = Number(values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0);
    const updatedToAssign = [...values[CONSTANTS.FIELD_KEYS.TO_ASSIGN]];
    updatedToAssign[idx] = newValRaw;
    const totals = calcTotals(values);
    const newTotals = calcTotals({
      [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: updatedToAssign,
      action: values[CONSTANTS.FIELD_KEYS.ACTION],
    });
    const poolForAddition = baseAssignable;
    const adjusted = adjustValue(
      action,
      newValRaw,
      oldVal,
      totals,
      newTotals,
      poolForAddition,
      users[idx].tasks
    );
    setFieldValue(`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`, adjusted);
  };

  const handleSubmit = (values, { setSubmitting, setFieldValue }) => {
    if (
      values[CONSTANTS.FIELD_KEYS.ALLOCATION_MODE] ===
        CONSTANTS.ALLOCATION_MODES.DISTRIBUTED &&
      values[CONSTANTS.FIELD_KEYS.GLOBAL_ADD_MODE] === "evenly"
    ) {
      CumulativePercent.recalc(values, setFieldValue);
    }
    if (
      values[CONSTANTS.FIELD_KEYS.ALLOCATION_MODE] ===
        CONSTANTS.ALLOCATION_MODES.DISTRIBUTED &&
      values[CONSTANTS.FIELD_KEYS.GLOBAL_ADD_MODE] === "perUser"
    ) {
      recalcNPerUser(
        values,
        setFieldValue,
        baseAssignable,
        Number(values.perUserChunk) || 0
      );
    }
    const updatedUsers = calcUpdatedUsers(values, users);
    setUsers(updatedUsers);
    const totals = calcTotals(values);
    const updatedAssignable = Math.max(
      0,
      baseAssignable + totals.totalSubtracted - totals.totalAdded
    );
    setAssignable(updatedAssignable);
    const newStore = {
      ...initialStore,
      assignableTasks: updatedAssignable,
      users: updatedUsers,
    };
    onUpdateInitialStore(newStore);
    values[CONSTANTS.FIELD_KEYS.TO_ASSIGN].forEach((_, idx) => {
      setFieldValue(`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
    });
    // Reset the appliedGlobalChunk to 0 on submit
    setFieldValue("appliedGlobalChunk", 0);
    setFieldValue("appliedPerUserChunk", 0);
    setSubmitting(false);
  };

  return (
    <Formik
      enableReinitialize
      initialValues={{
        combinedMode: "normal",
        [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
        [CONSTANTS.FIELD_KEYS.ACTION]: users.map(
          () => CONSTANTS.USER_ACTIONS.ADD
        ),
        [CONSTANTS.FIELD_KEYS.ALLOCATION_MODE]:
          CONSTANTS.ALLOCATION_MODES.NORMAL,
        [CONSTANTS.FIELD_KEYS.GLOBAL_ADD_MODE]: "perUser",
        perUserChunk: 0,
        appliedPerUserChunk: 0, // New field to hold the intermediate pool value
        globalChunk: 10, // for distributedEven mode, if still needed
        appliedGlobalChunk: 0,
        [CONSTANTS.FIELD_KEYS.QUALIFIER]: users.map(() => 0),
        [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
      }}
      onSubmit={handleSubmit}
    >
      {({ values, setFieldValue, setValues }) => (
        <Form
          className="container tasks"
          onKeyDown={(e) => {
            // If Enter is pressed...
            if (e.key === "Enter") {
              // Check if the target is a submit button
              // (you can check tagName and/or type attribute)
              const targetIsSubmit =
                e.target.tagName === "BUTTON" &&
                e.target.getAttribute("type") === "submit";

              if (!targetIsSubmit) {
                e.preventDefault();
              }
            }
          }}
        >
          <div className="section">
            <h3>Allocation Mode</h3>
            <div className="radio-group">
              <label>
                <Field
                  type="radio"
                  name="combinedMode"
                  value="normal"
                  onChange={() =>
                    setValues({
                      ...values,
                      combinedMode: "normal",
                      [CONSTANTS.FIELD_KEYS.ALLOCATION_MODE]:
                        CONSTANTS.ALLOCATION_MODES.NORMAL,
                      [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.ACTION]: users.map(
                        () => CONSTANTS.USER_ACTIONS.ADD
                      ),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: users.map(
                        () => false
                      ),
                    })
                  }
                  checked={values.combinedMode === "normal"}
                  disabled={!isLoaded}
                />
                Normal Allocation
              </label>
              <label>
                <Field
                  type="radio"
                  name="combinedMode"
                  value="distributedEven"
                  onChange={() =>
                    setValues({
                      ...values,
                      combinedMode: "distributedEven",
                      [CONSTANTS.FIELD_KEYS.ALLOCATION_MODE]:
                        CONSTANTS.ALLOCATION_MODES.DISTRIBUTED,
                      [CONSTANTS.FIELD_KEYS.GLOBAL_ADD_MODE]: "evenly",
                      [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.ACTION]: users.map(
                        () => CONSTANTS.USER_ACTIONS.ADD
                      ),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: users.map(
                        () => false
                      ),
                    })
                  }
                  checked={values.combinedMode === "distributedEven"}
                  disabled={!isLoaded}
                />
                Distributed Evenly
              </label>
              <label>
                <Field
                  type="radio"
                  name="combinedMode"
                  value="nPer"
                  onChange={() =>
                    setValues({
                      ...values,
                      combinedMode: "nPer",
                      [CONSTANTS.FIELD_KEYS.ALLOCATION_MODE]:
                        CONSTANTS.ALLOCATION_MODES.DISTRIBUTED,
                      [CONSTANTS.FIELD_KEYS.GLOBAL_ADD_MODE]: "perUser",
                      [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.ACTION]: users.map(
                        () => CONSTANTS.USER_ACTIONS.ADD
                      ),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: users.map(
                        () => false
                      ),
                    })
                  }
                  checked={values.combinedMode === "nPer"}
                  disabled={!isLoaded}
                />
                N per User
              </label>
            </div>
          </div>
          {(() => {
            switch (values.combinedMode) {
              case "normal":
                return (
                  <NormalAllocationForm
                    formikProps={{ values, setFieldValue, setValues }}
                    baseAssignable={baseAssignable}
                    users={users}
                    handleFieldChange={handleFieldChange}
                    isLoaded={isLoaded}
                  />
                );
              case "distributedEven":
                return (
                  <DistributedEvenForm
                    formikProps={{ values, setFieldValue, setValues }}
                    baseAssignable={baseAssignable}
                    users={users}
                    handleFieldChange={handleFieldChange}
                    isLoaded={isLoaded}
                  />
                );
              case "nPer":
                return (
                  <NPerUserForm
                    formikProps={{ values, setFieldValue, setValues }}
                    baseAssignable={baseAssignable}
                    users={users}
                    handleFieldChange={handleFieldChange}
                    isLoaded={isLoaded}
                  />
                );
              default:
                return null;
            }
          })()}
          <div className="section info-row">
            <div>
              <strong> Effective Pool:</strong>
              {calcEffectivePool(baseAssignable, values)}
            </div>
            <div>
              <strong>Total Allocated:</strong> {calcTotals(values).totalAdded}/{" "}
              {baseAssignable}
            </div>
          </div>
          <button
            type="submit"
            className="button mt-4"
            disabled={calcTotals(values).totalAdded > baseAssignable}
          >
            Submit
          </button>
        </Form>
      )}
    </Formik>
  );
};

export default TaskAllocationForm;
