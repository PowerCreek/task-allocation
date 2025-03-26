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

// (Re)assign qualifier field keys
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
  // Use the number of tasks assigned per user by using user.tasks.length
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

const ControlledToAssignInput = ({
  field,
  form,
  index,
  onValidatedChange,
  readOnly,
  style,
  isExcluded,
}) => {
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
            // Use user.tasks.length for the task count
            const taskCount = user.tasks.length;
            const currentVal = Number(
              values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
            );
            let remaining = 0;
            if (
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.ADD
            ) {
              // Here we assume poolForAddition is the baseAssignable; adjust as needed.
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
              remaining = taskCount - currentVal;
            }
            const pendingTotal =
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.ADD
                ? taskCount + currentVal
                : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                  CONSTANTS.USER_ACTIONS.SUBTRACT
                ? Math.max(0, taskCount - currentVal)
                : taskCount;
            return (
              <tr key={user.id}>
                <td className="td">{user.name}</td>
                <td className="td">{taskCount}</td>
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
                      taskCount
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

  // (Consolidation functions remain unchanged)
  const consolidateValuesBelow100 = (vals, pool) => {
    const { ACTION, QUALIFIER, QUALIFIER_LOCKED, TO_ASSIGN } =
      CONSTANTS.FIELD_KEYS;
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
      )
      .sort((a, b) => b.percent - a.percent);
    const implicitIndices = origQuals
      .map((q, i) => i)
      .filter(
        (i) => actions[i] !== CONSTANTS.USER_ACTIONS.EXCLUDE && !origLocks[i]
      );
    const excludedIndices = origQuals
      .map((q, i) => ({ index: i, percent: q }))
      .filter(
        ({ index, percent }) =>
          actions[index] !== CONSTANTS.USER_ACTIONS.EXCLUDE &&
          origLocks[index] &&
          percent === 0
      )
      .map(({ index }) => index);
    const totalExplicitPercent = explicitFields.reduce(
      (sum, f) => sum + forcedQuals[f.index],
      0
    );
    if (totalExplicitPercent >= 100) {
      const explicitDistribution = explicitFields.reduce((acc, f) => {
        const ideal = (forcedQuals[f.index] / 100) * pool;
        const initial = ideal > 0 ? Math.max(1, Math.floor(ideal)) : 0;
        acc[f.index] = initial;
        return acc;
      }, {});
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
    const reservedForImplicit =
      pool > implicitIndices.length ? 0 : implicitIndices.length;
    const availableExplicitPool = pool - reservedForImplicit;
    const explicitAllocations = explicitFields.map((f) => {
      const ideal = (forcedQuals[f.index] / 100) * availableExplicitPool;
      const initial = ideal > 0 ? Math.max(1, Math.floor(ideal)) : 0;
      const cap = Math.ceil(ideal);
      return { index: f.index, ideal, initial, cap, allocation: initial };
    });
    const explicitTotal = explicitAllocations.reduce(
      (sum, a) => sum + a.allocation,
      0
    );
    let leftover = availableExplicitPool - explicitTotal;
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
      adjustedExplicit.forEach((a, idx) => {
        explicitAllocations[idx] = a;
      });
    }
    const explicitDistribution = explicitAllocations.reduce((acc, a) => {
      acc[a.index] = Math.min(a.allocation, a.cap);
      return acc;
    }, {});
    let finalDist = new Array(origQuals.length).fill(0);
    explicitFields.forEach((f) => {
      finalDist[f.index] = explicitDistribution[f.index];
    });
    excludedIndices.forEach((i) => {
      finalDist[i] = 0;
    });
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
      implicitIndices.forEach((i) => {
        finalDist[i] = 0;
      });
    }
    return { ...vals, [TO_ASSIGN]: finalDist };
  };

  const consolidateValuesAt100 = (vals, pool) => {
    const { ACTION, QUALIFIER, QUALIFIER_LOCKED, TO_ASSIGN } =
      CONSTANTS.FIELD_KEYS;
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
    const availableExplicitPool = pool;
    if (explicitFields.length === 0) {
      return { ...vals, [TO_ASSIGN]: new Array(origQuals.length).fill(0) };
    }
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
    let totalAllocated = explicitAllocations.reduce(
      (sum, a) => sum + a.initial,
      0
    );
    let leftover = availableExplicitPool - totalAllocated;
    explicitAllocations.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < leftover; i++) {
      explicitAllocations[i % explicitAllocations.length].initial++;
    }
    let finalDist = new Array(origQuals.length).fill(0);
    explicitAllocations.forEach((f) => {
      finalDist[f.index] = f.initial;
    });
    finalDist = finalDist.map((v) => (isNaN(v) ? 0 : v));
    return { ...vals, [TO_ASSIGN]: finalDist };
  };

  const consolidateValues = (vals, pool) => {
    if (pool === 0) {
      const { TO_ASSIGN } = CONSTANTS.FIELD_KEYS;
      return { ...vals, [TO_ASSIGN]: vals[TO_ASSIGN].map(() => 0) };
    }
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

  const userRows = users.map((user, idx) => {
    // Use user.tasks.length for the count of work items.
    const taskCount = user.tasks.length;
    const currentVal = Number(values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0);
    let remaining = 0;
    if (
      values[CONSTANTS.FIELD_KEYS.ACTION][idx] === CONSTANTS.USER_ACTIONS.ADD
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
      remaining = taskCount - currentVal;
    }
    const pendingTotal =
      values[CONSTANTS.FIELD_KEYS.ACTION][idx] === CONSTANTS.USER_ACTIONS.ADD
        ? taskCount + currentVal
        : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
          CONSTANTS.USER_ACTIONS.SUBTRACT
        ? Math.max(0, taskCount - currentVal)
        : taskCount;
    const qualifierValue =
      Number(values[CONSTANTS.FIELD_KEYS.QUALIFIER][idx]) || 0;
    const totalExplicitSum = values[CONSTANTS.FIELD_KEYS.QUALIFIER].reduce(
      (sum, q, i) =>
        values[CONSTANTS.FIELD_KEYS.ACTION][i] !==
          CONSTANTS.USER_ACTIONS.EXCLUDE &&
        values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][i]
          ? sum + Number(q)
          : sum,
      0
    );
    const remPercentVal = Math.max(0, 100 - totalExplicitSum);
    const computedValue = values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]
      ? qualifierValue
      : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
        CONSTANTS.USER_ACTIONS.EXCLUDE
      ? 0
      : qualifierValue < 1 && remPercentVal > 0
      ? ""
      : qualifierValue;

    // Lifted field properties.
    const fieldProps = {
      fieldKeyAction: CONSTANTS.FIELD_KEYS.ACTION,
      userActionAdd: CONSTANTS.USER_ACTIONS.ADD,
      userActionExclude: CONSTANTS.USER_ACTIONS.EXCLUDE,
      toAssignKey: CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      fieldKeyQualifier: CONSTANTS.FIELD_KEYS.QUALIFIER,
      fieldKeyQualifierLocked: CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED,
      recalc: CumulativePercent.recalc,
      updateDistribution,
    };

    // Common row props.
    const fieldParams = {
      idx,
      values,
      setFieldValue,
      totals,
      user,
      disableSelect,
      ...fieldProps,
    };

    // ACTION FIELD BLOCK
    const actionField = (({
      idx,
      values,
      setFieldValue,
      totals,
      user,
      disableSelect,
      fieldKeyAction,
      userActionAdd,
      userActionExclude,
      toAssignKey,
      fieldKeyQualifier,
      fieldKeyQualifierLocked,
      recalc,
      updateDistribution,
    }) => {
      return (
        <td className="td" key={`action-field-${idx}`}>
          <Field
            as="select"
            name={`${fieldKeyAction}[${idx}][${values[fieldKeyAction][idx]}]`}
            value={values[fieldKeyAction][idx]}
            onChange={(e) => {
              const newValue = e.target.value;
              const rowStates = {
                [userActionExclude]: {
                  action: userActionExclude,
                  toAssign: 0,
                  qualifier: 0,
                  qualifierLocked: true,
                },
                [userActionAdd]: {
                  action: userActionAdd,
                  toAssign: 0,
                  qualifier: 0,
                  qualifierLocked: false,
                },
              };
              const initialRowState = rowStates[newValue] || {};
              setFieldValue(`${fieldKeyAction}[${idx}]`, newValue);
              setFieldValue(`${toAssignKey}[${idx}]`, initialRowState.toAssign);
              setFieldValue(
                `${fieldKeyQualifier}[${idx}]`,
                initialRowState.qualifier
              );
              setFieldValue(
                `${fieldKeyQualifierLocked}[${idx}]`,
                initialRowState.qualifierLocked
              );
              const updatedValues = {
                ...values,
                [fieldKeyAction]: values[fieldKeyAction].map((act, i) =>
                  i === idx ? initialRowState.action : act
                ),
                [toAssignKey]: values[toAssignKey].map((assign, i) =>
                  i === idx ? initialRowState.toAssign : assign
                ),
                [fieldKeyQualifier]: values[fieldKeyQualifier].map((q, i) =>
                  i === idx ? initialRowState.qualifier : q
                ),
                [fieldKeyQualifierLocked]: values[fieldKeyQualifierLocked].map(
                  (locked, i) =>
                    i === idx ? initialRowState.qualifierLocked : locked
                ),
              };
              recalc(updatedValues, setFieldValue);
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
              taskCount
            )}
          >
            <option value={userActionAdd}>Add</option>
            <option value={userActionExclude}>Exclude</option>
          </Field>
        </td>
      );
    })(fieldParams);

    // QUALIFIER FIELD BLOCK
    const qualifierField = (({
      idx,
      fieldKeyQualifier,
      fieldKeyQualifierLocked,
      fieldKeyAction,
      userActionExclude,
      computedValue,
      qualifierValue,
      remPercentVal,
      values,
      setFieldValue,
      recalc,
      updateDistribution,
      handleQualifierChange,
    }) => {
      const implicitValue =
        values[fieldKeyAction][idx] === userActionExclude
          ? "0"
          : !values[fieldKeyQualifierLocked][idx]
          ? qualifierValue < 1 && remPercentVal > 0
            ? "<1"
            : computedValue
          : "";
      const [localVal, setLocalVal] = React.useState("");
      React.useEffect(() => {
        if (values[fieldKeyQualifierLocked][idx]) {
          setLocalVal(computedValue);
        }
      }, [values[fieldKeyQualifierLocked][idx], computedValue, idx]);
      const onFocusHandler = (e) => {
        if (!localVal) {
          setLocalVal(implicitValue);
        }
        e.target.select();
      };
      const onChangeHandler = (e) => {
        const newVal = Math.max(0, e.target.value);
        setLocalVal(newVal);
        handleQualifierChange(
          { ...e, target: { ...e.target, value: newVal } },
          idx
        );
      };
      const onBlurHandler = (e) => {
        if (localVal !== implicitValue) {
          setFieldValue(`${fieldKeyQualifierLocked}[${idx}]`, true);
          setFieldValue(`${fieldKeyQualifier}[${idx}]`, localVal);
          const updatedValues = {
            ...values,
            [fieldKeyQualifier]: values[fieldKeyQualifier].map((q, i) =>
              i === idx ? localVal : q
            ),
            [fieldKeyQualifierLocked]: values[fieldKeyQualifierLocked].map(
              (locked, i) => (i === idx ? true : locked)
            ),
          };
          recalc(updatedValues, setFieldValue);
          updateDistribution(updatedValues, Number(values.appliedGlobalChunk));
        }
      };
      return (
        <td className="td" key={`qualifier-field-${idx}`}>
          <div>
            <div className="qualifierInputContainer">
              <input
                type="number"
                name={`${fieldKeyQualifier}[${idx}]`}
                disabled={values[fieldKeyAction][idx] === userActionExclude}
                onFocus={onFocusHandler}
                onChange={onChangeHandler}
                onBlur={onBlurHandler}
                value={localVal}
                placeholder={implicitValue}
                readOnly={values[fieldKeyAction][idx] === userActionExclude}
              />
            </div>
            <Field name={`${fieldKeyQualifierLocked}[${idx}]`}>
              {({ field }) => (
                <div className="checkbox-container">
                  <input
                    {...field}
                    type="checkbox"
                    checked={values[fieldKeyQualifierLocked][idx]}
                    className={
                      values[fieldKeyAction][idx] === CONSTANTS.USER_ACTIONS.ADD
                        ? "custom-checkbox"
                        : ""
                    }
                    disabled={values[fieldKeyAction][idx] === userActionExclude}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate =
                          values[fieldKeyAction][idx] === userActionExclude;
                      }
                    }}
                    onChange={(e) => {
                      const newLocked = e.target.checked;
                      setFieldValue(
                        `${fieldKeyQualifierLocked}[${idx}]`,
                        newLocked
                      );
                      const updatedValues = {
                        ...values,
                        [fieldKeyQualifierLocked]: values[
                          fieldKeyQualifierLocked
                        ].map((val, i) => (i === idx ? newLocked : val)),
                        [fieldKeyQualifier]: values[fieldKeyQualifier].map(
                          (q, i) => (i === idx ? (newLocked ? q : 0) : q)
                        ),
                      };
                      recalc(updatedValues, setFieldValue);
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
      );
    })(
      Object.assign({}, fieldParams, {
        computedValue,
        qualifierValue,
        remPercentVal,
        handleQualifierChange,
        updateDistribution,
      })
    );

    // TO ASSIGN FIELD BLOCK
    const toAssignField = (({
      idx,
      values,
      handleFieldChange,
      fieldKeyAction,
      userActionExclude,
      toAssignKey,
    }) => {
      const fieldName =
        values[fieldKeyAction][idx] === userActionExclude
          ? `exclude[${idx}]`
          : `toAssign[${idx}]`;
      const isExcluded = values[fieldKeyAction][idx] === userActionExclude;
      return (
        <td className="td" key={`toAssign-field-${idx}`}>
          <Field
            name={fieldName}
            isExcluded={isExcluded}
            component={ControlledToAssignInput}
            index={idx}
            onValidatedChange={handleFieldChange}
            readOnly={true}
          />
        </td>
      );
    })(Object.assign({}, fieldParams, { handleFieldChange }));

    const row = (
      <tr key={user.id}>
        <td className="td">{user.name}</td>
        <td className="td">{user.tasks.length}</td>
        {actionField}
        {qualifierField}
        {toAssignField}
        <td className="td">{pendingTotal}</td>
      </tr>
    );
    return row;
  });

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
            userRows}
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
  useEffect(() => {
    setFieldValue("appliedPerUserChunk", 0);
  }, [setFieldValue]);
  const appliedPerUserCap = Number(values.appliedPerUserChunk) || 0;
  const updateAppliedPerUserChunk = () => {
    setFieldValue("appliedPerUserChunk", values.perUserChunk);
    setFieldValue(
      CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      applyGlobalAddLogic(
        { ...values, appliedPerUserChunk: values.perUserChunk },
        baseAssignable,
        values.perUserChunk
      )
    );
  };

  const handleActionChange = (idx, newValue) => {
    setFieldValue(`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`, newValue);

    if (newValue === CONSTANTS.USER_ACTIONS.EXCLUDE) {
      setFieldValue(`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
    }

    const updatedValues = {
      ...values,
      [CONSTANTS.FIELD_KEYS.ACTION]: values[CONSTANTS.FIELD_KEYS.ACTION].map(
        (act, i) => (i === idx ? newValue : act)
      ),
    };

    // Recalculate all `toAssign` fields when "Add" is selected
    recalcNPerUser(
      updatedValues,
      setFieldValue,
      baseAssignable,
      values.appliedPerUserChunk
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
            onChange={(e) => {
              let newChunk = Number(e.target.value);
              if (isNaN(newChunk) || newChunk < 0) newChunk = 0;
              if (newChunk > baseAssignable) newChunk = baseAssignable;
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
                  ? user.tasks.length + currentVal
                  : values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                    CONSTANTS.USER_ACTIONS.SUBTRACT
                  ? Math.max(0, user.tasks.length - currentVal)
                  : user.tasks.length;
              return (
                <tr key={user.id}>
                  <td className="td">{user.name}</td>
                  <td className="td">{user.tasks.length}</td>
                  <td className="td">
                    <Field
                      as="select"
                      name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`}
                      value={values[CONSTANTS.FIELD_KEYS.ACTION][idx]}
                      onChange={(e) => handleActionChange(idx, e.target.value)}
                      disabled={disableSelect(
                        values,
                        idx,
                        totals,
                        baseAssignable,
                        user.tasks.length
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
      users[idx].tasks.length
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
        appliedPerUserChunk: 0,
        globalChunk: 10,
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
            if (e.key === "Enter") {
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
              <strong> Effective Pool:</strong>{" "}
              {calcEffectivePool(baseAssignable, values)}
            </div>
            <div>
              <strong>Total Allocated:</strong> {calcTotals(values).totalAdded}/
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
