// taskAllocation.jsx
import { Field, Form, Formik } from "formik";
import React, { useEffect, useState } from "react";
import "./App.css";
import {
  ALLOCATION_MODES,
  FIELD_KEYS,
  USER_ACTIONS,
  adjustValue,
  applyGlobalAddLogic, // used for N per User mode only
  calcEffectivePool,
  calcTotals,
  calcUpdatedUsers,
  disableSelect,
} from "./TaskAllocationHelpers";

// Add new keys for qualifier fields.
FIELD_KEYS.QUALIFIER = "qualifier";
FIELD_KEYS.QUALIFIER_LOCKED = "qualifierLocked";

// Consolidated modes constant.
const CONSOLIDATED_MODES = {
  DISTRIBUTED_EVEN: "evenly",
  DISTRIBUTED_N: "perUser",
};

/* ---------------- Helper Modules ---------------- */

/**
 * CumulativePercent encapsulates the cumulative percentage logic used in Distributed Evenly mode.
 * It recalculates the qualifier values for all non‑excluded rows.
 */
const CumulativePercent = {
  recalc: (values, setFieldValue) => {
    const lockedArr = values[FIELD_KEYS.QUALIFIER_LOCKED];
    const totalExplicit = values[FIELD_KEYS.QUALIFIER].reduce((sum, q, i) => {
      if (values[FIELD_KEYS.ACTION][i] === USER_ACTIONS.EXCLUDE) return sum;
      return sum + (lockedArr[i] ? Number(q) : 0);
    }, 0);
    const unlockedIndices = lockedArr
      .map((locked, i) =>
        !locked && values[FIELD_KEYS.ACTION][i] !== USER_ACTIONS.EXCLUDE
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
      setFieldValue(`${FIELD_KEYS.QUALIFIER}[${i}]`, newValue);
    });
  },
  clampValue: (values, idx, candidate) => {
    if (values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.EXCLUDE) return 0;
    const otherExplicitSum = values[FIELD_KEYS.QUALIFIER].reduce(
      (sum, q, i) => {
        if (i === idx) return sum;
        if (values[FIELD_KEYS.ACTION][i] === USER_ACTIONS.EXCLUDE) return sum;
        return sum + (values[FIELD_KEYS.QUALIFIER_LOCKED][i] ? Number(q) : 0);
      },
      0
    );
    const available = Math.max(0, 100 - otherExplicitSum);
    return Math.floor(Math.max(0, Math.min(available, candidate)));
  },
};

/**
 * recalcNPerUser recalculates the "toAssign" fields for N per User mode.
 * It uses the baseAssignable pool directly and distributes tasks sequentially.
 */
const recalcNPerUser = (
  values,
  setFieldValue,
  baseAssignable,
  perUserChunk
) => {
  const nonExcludedIndices = values[FIELD_KEYS.ACTION]
    .map((act, i) => (act === USER_ACTIONS.ADD ? i : null))
    .filter((i) => i !== null);
  const count = nonExcludedIndices.length;
  if (count === 0) {
    setFieldValue(
      FIELD_KEYS.TO_ASSIGN,
      values[FIELD_KEYS.TO_ASSIGN].map(() => 0)
    );
    return;
  }
  let remainingPool = baseAssignable;
  const newAllocations = values[FIELD_KEYS.TO_ASSIGN].map(() => 0);
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
  setFieldValue(FIELD_KEYS.TO_ASSIGN, newAllocations);
};

/**
 * applyDistributedEvenLogic computes the change amounts for Distributed Evenly mode.
 * For each eligible row (action === Add), the allocation is computed as:
 *    allocation = floor((qualifier / 100) * globalChunk)
 * If an implicit (unchecked) row computes to 0 and there is remaining capacity,
 * it is allocated 1 task.
 * Any leftover remainder is then distributed sequentially.
 * Rows with an explicit exclusion (or locked 0) remain at 0.
 */
const applyDistributedEvenLogic = (values) => {
  const globalChunk = Number(values.globalChunk) || 0;
  if (globalChunk <= 0) return values[FIELD_KEYS.TO_ASSIGN];

  const eligibleIndices = values[FIELD_KEYS.ACTION]
    .map((act, idx) => (act === USER_ACTIONS.ADD ? idx : null))
    .filter((idx) => idx !== null);

  if (eligibleIndices.length === 0) return values[FIELD_KEYS.TO_ASSIGN];

  let newAllocations = new Array(values[FIELD_KEYS.TO_ASSIGN].length).fill(0);
  let totalExplicitPercent = 0;
  let explicitIndices = [];
  let implicitIndices = [];

  // Classify indices into explicit (locked) and implicit (unlocked).
  // Note: We keep the bump logic only for explicit fields that have a non-zero qualifier.
  eligibleIndices.forEach((idx) => {
    const qualifier = Number(values[FIELD_KEYS.QUALIFIER][idx]);
    if (values[FIELD_KEYS.QUALIFIER_LOCKED][idx]) {
      if (qualifier > 0) {
        explicitIndices.push(idx);
        totalExplicitPercent += qualifier;
      }
      // If locked but set to 0, do not push into explicitIndices (so it won't be bumped).
    } else {
      implicitIndices.push(idx);
    }
  });

  if (totalExplicitPercent > 100) {
    throw new Error("Total locked percentages exceed 100%");
  }

  let allowImplicitAllocation = totalExplicitPercent < 100;
  let remainingPercent = Math.max(0, 100 - totalExplicitPercent);
  let minImplicitAllocation = allowImplicitAllocation
    ? Math.min(globalChunk, implicitIndices.length)
    : 0;
  let remainingChunk = globalChunk - minImplicitAllocation;
  let totalAllocated = 0;

  // First allocate explicit percentages (bump logic applies here for non-zero locked fields).
  explicitIndices.forEach((idx) => {
    let percent = Number(values[FIELD_KEYS.QUALIFIER][idx]) / 100;
    newAllocations[idx] = Math.floor(percent * remainingChunk);
    totalAllocated += newAllocations[idx];
  });

  // If implicit allocation is allowed, assign a minimum of 1 allocation to each implicit field.
  if (allowImplicitAllocation) {
    implicitIndices.forEach((idx) => {
      newAllocations[idx] = 1;
      totalAllocated++;
    });
  }

  // Distribute any remainder sequentially.
  let remainder = globalChunk - totalAllocated;
  const allIndices = [...explicitIndices, ...implicitIndices];
  for (let i = 0; i < allIndices.length && remainder > 0; i++) {
    const idx = allIndices[i];
    newAllocations[idx]++;
    remainder--;
  }

  // Bump logic: For each explicit (locked) row that has a non-zero qualifier but ended up with 0,
  // bump it to 1.
  explicitIndices.forEach((idx) => {
    if (
      Number(values[FIELD_KEYS.QUALIFIER][idx]) > 0 &&
      newAllocations[idx] === 0
    ) {
      newAllocations[idx] = 1;
    }
  });

  // Recalculate available pool for implicit rows using the cap per user.
  const explicitTotal = explicitIndices.reduce(
    (sum, idx) => sum + newAllocations[idx],
    0
  );
  const remainingPool = Math.max(0, Number(values.globalChunk) - explicitTotal);
  if (implicitIndices.length > 0) {
    const baseImplicit = Math.floor(remainingPool / implicitIndices.length);
    const extraImplicit = remainingPool % implicitIndices.length;
    implicitIndices.forEach((idx, i) => {
      newAllocations[idx] = baseImplicit + (i < extraImplicit ? 1 : 0);
    });
  }

  return newAllocations;
};

/**
 * ControlledToAssignInput is a custom input component that tracks its own internal state.
 */
const ControlledToAssignInput = ({
  field,
  form,
  index,
  onValidatedChange,
  readOnly,
  style,
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
      value={internalValue}
      onChange={handleChange}
      readOnly={readOnly}
      style={style}
    />
  );
};

/* ---------------- Branch Components ---------------- */

/**
 * NormalAllocationForm renders the UI for Normal Allocation mode.
 */
const NormalAllocationForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
}) => {
  const { values, setFieldValue } = formikProps;
  const totals = calcTotals(values);
  return (
    <table className="table">
      <thead>
        <tr>
          <th className="th">User</th>
          <th className="th">Current Tasks</th>
          <th className="th">Action</th>
          <th className="th">Change Amount</th>
          <th className="th">Remaining</th>
          <th className="th">Pending Total</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user, idx) => {
          const currentVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
          let remaining = 0;
          if (values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD) {
            const poolForAddition = baseAssignable;
            const addMax = Math.max(
              0,
              poolForAddition - (totals.totalAdded - currentVal)
            );
            remaining = Math.max(0, addMax - currentVal);
          } else if (values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT) {
            remaining = user.tasks - currentVal;
          }
          const pendingTotal =
            values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD
              ? user.tasks + currentVal
              : values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT
              ? Math.max(0, user.tasks - currentVal)
              : user.tasks;
          return (
            <tr key={user.id}>
              <td className="td">{user.name}</td>
              <td className="td">{user.tasks}</td>
              <td className="td">
                <Field
                  as="select"
                  name={`${FIELD_KEYS.ACTION}[${idx}]`}
                  value={values[FIELD_KEYS.ACTION][idx]}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setFieldValue(`${FIELD_KEYS.ACTION}[${idx}]`, newValue);
                    // In Normal mode, if a row is excluded, set its change amount to 0.
                    if (newValue === USER_ACTIONS.EXCLUDE) {
                      setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
                    }
                  }}
                  disabled={disableSelect(
                    values,
                    idx,
                    totals,
                    baseAssignable,
                    user.tasks
                  )}
                  style={{ width: "100px", padding: "5px" }}
                >
                  <option value={USER_ACTIONS.ADD}>Add</option>
                  <option value={USER_ACTIONS.SUBTRACT}>Reassign</option>
                </Field>
              </td>
              <td className="td">
                <Field
                  name={`${FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                  component={ControlledToAssignInput}
                  index={idx}
                  onValidatedChange={handleFieldChange}
                  readOnly={false}
                  style={{ width: "80px", padding: "5px" }}
                />
              </td>
              <td className="td">
                <button
                  type="button"
                  onClick={() =>
                    setFieldValue(
                      `${FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                      Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0) + remaining
                    )
                  }
                  className="button"
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
 * In this mode, each eligible row’s change amount is computed based on:
 *    allocation = floor((qualifier / 100) * globalChunk)
 * with any leftover remainder distributed sequentially.
 * Excluded rows (or rows with an explicit 0% via a locked checkbox) are treated as 0.
 */
const DistributedEvenForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
}) => {
  const { values, setFieldValue } = formikProps;

  // Consolidation function that computes percent values and distributes tasks.
  const consolidateValues = (vals) => {
    const newValues = {
      ...vals,
      [FIELD_KEYS.QUALIFIER]: [...vals[FIELD_KEYS.QUALIFIER]],
      [FIELD_KEYS.QUALIFIER_LOCKED]: [...vals[FIELD_KEYS.QUALIFIER_LOCKED]],
      [FIELD_KEYS.TO_ASSIGN]: [...vals[FIELD_KEYS.TO_ASSIGN]],
    };

    // Force excluded rows to 0 and lock them.
    newValues[FIELD_KEYS.ACTION].forEach((act, idx) => {
      if (act === USER_ACTIONS.EXCLUDE) {
        newValues[FIELD_KEYS.QUALIFIER][idx] = 0;
        newValues[FIELD_KEYS.QUALIFIER_LOCKED][idx] = true;
      }
    });

    // Partition rows into explicit (locked) and implicit (unlocked)
    const explicitIndices = [];
    const implicitIndices = [];
    newValues[FIELD_KEYS.ACTION].forEach((act, idx) => {
      if (act !== USER_ACTIONS.EXCLUDE) {
        if (newValues[FIELD_KEYS.QUALIFIER_LOCKED][idx]) {
          explicitIndices.push(idx);
        } else {
          implicitIndices.push(idx);
        }
      }
    });

    // Calculate the total explicit percentage (user-set).
    const sumExplicit = explicitIndices.reduce(
      (sum, idx) => sum + Number(newValues[FIELD_KEYS.QUALIFIER][idx]),
      0
    );
    const remainingPercent = Math.max(0, 100 - sumExplicit);
    const countImplicit = implicitIndices.length;
    if (countImplicit > 0) {
      if (remainingPercent >= countImplicit) {
        implicitIndices.forEach((idx) => {
          newValues[FIELD_KEYS.QUALIFIER][idx] = 1;
        });
        let leftover = remainingPercent - countImplicit;
        if (leftover > 0) {
          const baseExtra = Math.floor(leftover / countImplicit);
          const extra = leftover % countImplicit;
          implicitIndices.forEach((idx, i) => {
            newValues[FIELD_KEYS.QUALIFIER][idx] +=
              baseExtra + (i < extra ? 1 : 0);
          });
        }
      } else {
        const basePercent = Math.floor(remainingPercent / countImplicit);
        const extra = remainingPercent % countImplicit;
        implicitIndices.forEach((idx, i) => {
          newValues[FIELD_KEYS.QUALIFIER][idx] =
            basePercent + (i < extra ? 1 : 0);
        });
      }
    }

    // Compute an initial distribution.
    let distribution = applyDistributedEvenLogic(newValues);

    // Bump logic: for each explicit row (locked) with a non-zero qualifier that got 0, bump it to 1.
    explicitIndices.forEach((idx) => {
      if (
        Number(newValues[FIELD_KEYS.QUALIFIER][idx]) > 0 &&
        distribution[idx] === 0
      ) {
        distribution[idx] = 1;
      }
    });

    // Recalculate the available pool for implicit rows using the cap per user.
    const explicitTotal = explicitIndices.reduce(
      (sum, idx) => sum + distribution[idx],
      0
    );
    const remainingPool = Math.max(0, Number(vals.globalChunk) - explicitTotal);
    if (implicitIndices.length > 0) {
      const baseImplicit = Math.floor(remainingPool / implicitIndices.length);
      const extraImplicit = remainingPool % implicitIndices.length;
      implicitIndices.forEach((idx, i) => {
        distribution[idx] = baseImplicit + (i < extraImplicit ? 1 : 0);
      });
    }

    newValues[FIELD_KEYS.TO_ASSIGN] = distribution;
    return newValues;
  };

  // Centralized update function that recalculates distribution.
  const updateDistribution = (updatedValues) => {
    const consolidated = consolidateValues(updatedValues);
    setFieldValue(FIELD_KEYS.TO_ASSIGN, consolidated[FIELD_KEYS.TO_ASSIGN]);
  };

  const updateConsolidatedValues = () => {
    updateDistribution(values);
  };

  const totals = calcTotals(values);

  return (
    <>
      <div className="section">
        <label className="label" style={{ marginRight: "10px" }}>
          Global Chunk (Cap per User):
          <Field
            type="number"
            name="globalChunk"
            min="0"
            style={{ marginLeft: "5px", width: "60px" }}
          />
        </label>
        <button
          type="button"
          onClick={updateConsolidatedValues}
          className="button"
        >
          Apply Global Add
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="th">User</th>
            <th className="th">Current Tasks</th>
            <th className="th">Action</th>
            <th className="th">Weighted Percent (%)</th>
            <th className="th">Change Amount</th>
            <th className="th">Remaining</th>
            <th className="th">Pending Total</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, idx) => {
            const currentVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
            let remaining = 0;
            if (values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD) {
              const poolForAddition = Number(values.globalChunk);
              const addMax = Math.max(
                0,
                poolForAddition - (totals.totalAdded - currentVal)
              );
              remaining = Math.max(0, addMax - currentVal);
            } else if (
              values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT
            ) {
              remaining = user.tasks - currentVal;
            }
            const pendingTotal =
              values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD
                ? user.tasks + currentVal
                : values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT
                ? Math.max(0, user.tasks - currentVal)
                : user.tasks;

            // Compute the display value for the qualifier field.
            const qualifierValue =
              Number(values[FIELD_KEYS.QUALIFIER][idx]) || 0;
            const totalExplicitSum = values[FIELD_KEYS.QUALIFIER].reduce(
              (sum, q, i) =>
                values[FIELD_KEYS.ACTION][i] !== USER_ACTIONS.EXCLUDE &&
                values[FIELD_KEYS.QUALIFIER_LOCKED][i]
                  ? sum + Number(q)
                  : sum,
              0
            );
            const remPercent = Math.max(0, 100 - totalExplicitSum);
            // For unlocked fields, if the qualifier is less than 1 and there’s remaining percent, show empty (to trigger "<1%" placeholder).
            // For locked fields, always show the actual numeric value.
            const computedValue = values[FIELD_KEYS.QUALIFIER_LOCKED][idx]
              ? qualifierValue
              : values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.EXCLUDE
              ? 0
              : qualifierValue < 1 && remPercent > 0
              ? ""
              : qualifierValue;

            return (
              <tr key={user.id}>
                <td className="td">{user.name}</td>
                <td className="td">{user.tasks}</td>
                <td className="td">
                  <Field
                    as="select"
                    name={`${FIELD_KEYS.ACTION}[${idx}]`}
                    value={values[FIELD_KEYS.ACTION][idx]}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setFieldValue(`${FIELD_KEYS.ACTION}[${idx}]`, newValue);
                      const updatedValues = {
                        ...values,
                        [FIELD_KEYS.ACTION]: values[FIELD_KEYS.ACTION].map(
                          (act, i) => (i === idx ? newValue : act)
                        ),
                      };
                      if (newValue === USER_ACTIONS.EXCLUDE) {
                        setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
                        setFieldValue(`${FIELD_KEYS.QUALIFIER}[${idx}]`, 0);
                        setFieldValue(
                          `${FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                          true
                        );
                      }
                      updateDistribution(updatedValues);
                    }}
                    disabled={disableSelect(
                      values,
                      idx,
                      totals,
                      baseAssignable,
                      user.tasks
                    )}
                    style={{ width: "100px", padding: "5px" }}
                  >
                    <option value={USER_ACTIONS.ADD}>Add</option>
                    <option value={USER_ACTIONS.EXCLUDE}>Exclude</option>
                  </Field>
                </td>
                <td className="td">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    {(() => {
                      return (
                        <Field
                          name={`${FIELD_KEYS.QUALIFIER}[${idx}]`}
                          type="number"
                          onChange={(e) => {
                            const newCandidate = Number(e.target.value) || 0;
                            const clamped = CumulativePercent.clampValue(
                              values,
                              idx,
                              newCandidate
                            );
                            setFieldValue(
                              `${FIELD_KEYS.QUALIFIER}[${idx}]`,
                              clamped
                            );
                            setFieldValue(
                              `${FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                              true
                            );
                            const updatedQualifiers = values[
                              FIELD_KEYS.QUALIFIER
                            ].map((q, i) => (i === idx ? clamped : q));
                            const updatedValues = {
                              ...values,
                              [FIELD_KEYS.QUALIFIER]: updatedQualifiers,
                            };
                            CumulativePercent.recalc(
                              updatedValues,
                              setFieldValue
                            );
                            updateDistribution(updatedValues);
                          }}
                          value={computedValue}
                          placeholder={
                            !values[FIELD_KEYS.QUALIFIER_LOCKED][idx] &&
                            qualifierValue < 1 &&
                            remPercent > 0
                              ? "<1%"
                              : ""
                          }
                          style={{ width: "60px", padding: "5px" }}
                          readOnly={
                            values[FIELD_KEYS.ACTION][idx] ===
                            USER_ACTIONS.EXCLUDE
                          }
                        />
                      );
                    })()}
                    <Field
                      name={`${FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`}
                      type="checkbox"
                      onChange={(e) => {
                        const newLocked = e.target.checked;
                        setFieldValue(
                          `${FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                          newLocked
                        );
                        const updatedValues = {
                          ...values,
                          [FIELD_KEYS.QUALIFIER_LOCKED]: values[
                            FIELD_KEYS.QUALIFIER_LOCKED
                          ].map((val, i) => (i === idx ? newLocked : val)),
                        };
                        CumulativePercent.recalc(updatedValues, setFieldValue);
                        updateDistribution(updatedValues);
                      }}
                      checked={values[FIELD_KEYS.QUALIFIER_LOCKED][idx]}
                      disabled={
                        values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.EXCLUDE
                      }
                    />
                  </div>
                </td>
                <td className="td">
                  <Field
                    name={`${FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                    component={ControlledToAssignInput}
                    index={idx}
                    onValidatedChange={handleFieldChange}
                    readOnly={true}
                    style={{ width: "80px", padding: "5px" }}
                  />
                </td>
                <td className="td">{remaining}</td>
                <td className="td">{pendingTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
};

/**
 * NPerUserForm renders the UI for N per User mode.
 * When a row’s action changes to "Exclude", recalcNPerUser is triggered.
 */
const NPerUserForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
}) => {
  const { values, setFieldValue } = formikProps;
  const totals = calcTotals(values);
  return (
    <>
      <div className="section">
        <label className="label" style={{ marginRight: "10px" }}>
          Per User Chunk:
          <Field
            type="number"
            name="perUserChunk"
            style={{ marginLeft: "5px", width: "60px" }}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setFieldValue(
              FIELD_KEYS.TO_ASSIGN,
              applyGlobalAddLogic(values, baseAssignable)
            )
          }
          className="button"
        >
          Apply Global Add
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="th">User</th>
            <th className="th">Current Tasks</th>
            <th className="th">Action</th>
            <th className="th">Change Amount</th>
            <th className="th">Remaining</th>
            <th className="th">Pending Total</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, idx) => {
            const currentVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
            let remaining = 0;
            if (values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD) {
              const poolForAddition = baseAssignable;
              const addMax = Math.max(
                0,
                poolForAddition - (totals.totalAdded - currentVal)
              );
              remaining = Math.max(0, addMax - currentVal);
            } else if (
              values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT
            ) {
              remaining = user.tasks - currentVal;
            }
            const pendingTotal =
              values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.ADD
                ? user.tasks + currentVal
                : values[FIELD_KEYS.ACTION][idx] === USER_ACTIONS.SUBTRACT
                ? Math.max(0, user.tasks - currentVal)
                : user.tasks;
            return (
              <tr key={user.id}>
                <td className="td">{user.name}</td>
                <td className="td">{user.tasks}</td>
                <td className="td">
                  <Field
                    as="select"
                    name={`${FIELD_KEYS.ACTION}[${idx}]`}
                    value={values[FIELD_KEYS.ACTION][idx]}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setFieldValue(`${FIELD_KEYS.ACTION}[${idx}]`, newValue);
                      const updatedValues = {
                        ...values,
                        [FIELD_KEYS.ACTION]: values[FIELD_KEYS.ACTION].map(
                          (act, i) => (i === idx ? newValue : act)
                        ),
                      };
                      if (newValue === USER_ACTIONS.EXCLUDE) {
                        setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
                        recalcNPerUser(
                          updatedValues,
                          setFieldValue,
                          baseAssignable,
                          Number(values.perUserChunk) || 0
                        );
                      } else if (newValue === USER_ACTIONS.ADD) {
                        updatedValues[FIELD_KEYS.TO_ASSIGN] =
                          applyGlobalAddLogic(updatedValues, baseAssignable);
                        setFieldValue(
                          FIELD_KEYS.TO_ASSIGN,
                          updatedValues[FIELD_KEYS.TO_ASSIGN]
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
                    style={{ width: "100px", padding: "5px" }}
                  >
                    <option value={USER_ACTIONS.ADD}>Add</option>
                    <option value={USER_ACTIONS.EXCLUDE}>Exclude</option>
                  </Field>
                </td>
                <td className="td">
                  <Field
                    name={`${FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                    component={ControlledToAssignInput}
                    index={idx}
                    onValidatedChange={handleFieldChange}
                    readOnly={true}
                    style={{ width: "80px", padding: "5px" }}
                  />
                </td>
                <td className="td">{remaining}</td>
                <td className="td">{pendingTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
};

/* ---------------- Main Container Component ---------------- */

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

  // Common field change handler.
  const handleFieldChange = (e, idx, values, setFieldValue) => {
    const action = values[FIELD_KEYS.ACTION][idx];
    const { value } = e.target;
    const numericValue = parseFloat(value);
    const newValRaw = isNaN(numericValue) ? 0 : Math.max(0, numericValue);
    const oldVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
    const updatedToAssign = [...values[FIELD_KEYS.TO_ASSIGN]];
    updatedToAssign[idx] = newValRaw;
    const totals = calcTotals(values);
    const newTotals = calcTotals({
      [FIELD_KEYS.TO_ASSIGN]: updatedToAssign,
      action: values[FIELD_KEYS.ACTION],
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
    setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, adjusted);
  };

  const handleSubmit = (values, { setSubmitting, setFieldValue }) => {
    if (
      values[FIELD_KEYS.ALLOCATION_MODE] === ALLOCATION_MODES.DISTRIBUTED &&
      values[FIELD_KEYS.GLOBAL_ADD_MODE] === "evenly"
    ) {
      CumulativePercent.recalc(values, setFieldValue);
    }
    if (
      values[FIELD_KEYS.ALLOCATION_MODE] === ALLOCATION_MODES.DISTRIBUTED &&
      values[FIELD_KEYS.GLOBAL_ADD_MODE] === "perUser"
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
    values[FIELD_KEYS.TO_ASSIGN].forEach((_, idx) => {
      setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
    });
    setSubmitting(false);
  };

  return (
    <Formik
      enableReinitialize
      initialValues={{
        combinedMode: "normal",
        [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
        [FIELD_KEYS.ACTION]: users.map(() => USER_ACTIONS.ADD),
        [FIELD_KEYS.ALLOCATION_MODE]: ALLOCATION_MODES.NORMAL,
        // "perUser" means N per User; "evenly" means Distributed Evenly.
        [FIELD_KEYS.GLOBAL_ADD_MODE]: "perUser",
        perUserChunk: 0,
        globalChunk: 10,
        [FIELD_KEYS.QUALIFIER]: users.map(() => 0),
        [FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
      }}
      onSubmit={handleSubmit}
    >
      {({ values, setFieldValue, setValues }) => (
        <Form className="container">
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
                      [FIELD_KEYS.ALLOCATION_MODE]: ALLOCATION_MODES.NORMAL,
                      [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [FIELD_KEYS.ACTION]: users.map(() => USER_ACTIONS.ADD),
                      [FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
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
                      [FIELD_KEYS.ALLOCATION_MODE]:
                        ALLOCATION_MODES.DISTRIBUTED,
                      [FIELD_KEYS.GLOBAL_ADD_MODE]: "evenly",
                      [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [FIELD_KEYS.ACTION]: users.map(() => USER_ACTIONS.ADD),
                      [FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
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
                      [FIELD_KEYS.ALLOCATION_MODE]:
                        ALLOCATION_MODES.DISTRIBUTED,
                      [FIELD_KEYS.GLOBAL_ADD_MODE]: "perUser",
                      [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                      [FIELD_KEYS.ACTION]: users.map(() => USER_ACTIONS.ADD),
                      [FIELD_KEYS.QUALIFIER]: users.map(() => 0),
                      [FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
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
                  />
                );
              case "distributedEven":
                return (
                  <DistributedEvenForm
                    formikProps={{ values, setFieldValue, setValues }}
                    baseAssignable={baseAssignable}
                    users={users}
                    handleFieldChange={handleFieldChange}
                  />
                );
              case "nPer":
                return (
                  <NPerUserForm
                    formikProps={{ values, setFieldValue, setValues }}
                    baseAssignable={baseAssignable}
                    users={users}
                    handleFieldChange={handleFieldChange}
                  />
                );
              default:
                return null;
            }
          })()}

          <div className="section info-row">
            <div>
              Effective Pool: {calcEffectivePool(baseAssignable, values)}
            </div>
            <div>
              <strong>Total Allocated (Add):</strong>{" "}
              {calcTotals(values).totalAdded} / {baseAssignable}
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
