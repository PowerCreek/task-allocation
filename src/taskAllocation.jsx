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

const applyDistributedEvenLogic = (values, pool) => {
  const globalChunk = Number(pool) || 0;
  if (!globalChunk) return values[CONSTANTS.FIELD_KEYS.TO_ASSIGN];

  const eligibleIndices = values[CONSTANTS.FIELD_KEYS.ACTION]
    .map((act, idx) => (act === CONSTANTS.USER_ACTIONS.ADD ? idx : null))
    .filter((idx) => idx !== null);
  if (eligibleIndices.length === 0)
    return values[CONSTANTS.FIELD_KEYS.TO_ASSIGN];

  let newAllocations = new Array(
    values[CONSTANTS.FIELD_KEYS.TO_ASSIGN].length
  ).fill(0);
  let totalExplicitPercent = 0;
  let explicitIndices = [],
    implicitIndices = [];
  eligibleIndices.forEach((idx) => {
    const qualifier = Number(values[CONSTANTS.FIELD_KEYS.QUALIFIER][idx]);
    if (values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx] && qualifier <= 0)
      return;
    if (values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]) {
      explicitIndices.push(idx);
      totalExplicitPercent += qualifier;
    } else {
      implicitIndices.push(idx);
    }
  });
  if (totalExplicitPercent > 100) {
    throw new Error("Total locked percentages exceed 100%");
  }
  const allowImplicitAllocation = totalExplicitPercent < 100;
  const remainingPercent = Math.max(0, 100 - totalExplicitPercent);
  const minImplicitAllocation = allowImplicitAllocation
    ? Math.min(globalChunk, implicitIndices.length)
    : 0;
  let remainingChunk = globalChunk - minImplicitAllocation;
  let totalAllocated = 0;
  explicitIndices.forEach((idx) => {
    let percent = Number(values[CONSTANTS.FIELD_KEYS.QUALIFIER][idx]) / 100;
    newAllocations[idx] = Math.floor(percent * remainingChunk);
    totalAllocated += newAllocations[idx];
  });
  if (allowImplicitAllocation) {
    implicitIndices.forEach((idx) => {
      newAllocations[idx] = 1;
      totalAllocated++;
    });
  }
  let remainder = globalChunk - totalAllocated;
  const allIndices = [...explicitIndices, ...implicitIndices];
  for (let i = 0; i < allIndices.length && remainder > 0; i++) {
    newAllocations[allIndices[i]]++;
    remainder--;
  }
  explicitIndices.forEach((idx) => {
    if (
      Number(values[CONSTANTS.FIELD_KEYS.QUALIFIER][idx]) > 0 &&
      newAllocations[idx] === 0
    ) {
      newAllocations[idx] = 1;
    }
  });
  const explicitTotal = explicitIndices.reduce(
    (sum, idx) => sum + newAllocations[idx],
    0
  );
  const remainingPool = Math.max(0, Number(pool) - explicitTotal);
  if (implicitIndices.length) {
    const baseImplicit = Math.floor(remainingPool / implicitIndices.length);
    const extraImplicit = remainingPool % implicitIndices.length;
    implicitIndices.forEach((idx, i) => {
      newAllocations[idx] = baseImplicit + (i < extraImplicit ? 1 : 0);
    });
  }
  return newAllocations;
};

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
                  name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`}
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
                  style={{ width: "100px", padding: "5px" }}
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
                  style={{ width: "80px", padding: "5px" }}
                />
              </td>
              <td className="td">
                <button
                  type="button"
                  onClick={() =>
                    setFieldValue(
                      `${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                      Number(values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0) +
                        remaining
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
 * Here we store an applied pool (globalPool) separately from the
 * raw input globalChunk value. The global chunk input is clamped
 * to be within 0 and the base assignable, and the Apply Global Add
 * button sets the applied pool without modifying other distribution values.
 */
const DistributedEvenForm = ({
  formikProps,
  baseAssignable,
  users,
  handleFieldChange,
}) => {
  const { values, setFieldValue } = formikProps;
  // We no longer rely on a separate state for globalPool,
  // instead we pass the current values.globalChunk to our update logic.

  // consolidateValues uses the provided pool value to calculate distribution.
  const consolidateValues = (vals, pool) => {
    const actions = vals[CONSTANTS.FIELD_KEYS.ACTION];
    const origQuals = vals[CONSTANTS.FIELD_KEYS.QUALIFIER];
    const origLocks = vals[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED];

    // 1. Apply EXCLUDE logic
    const forcedQuals = origQuals.map((q, i) =>
      actions[i] === CONSTANTS.USER_ACTIONS.EXCLUDE ? 0 : q
    );
    const forcedLocks = origLocks.map((l, i) =>
      actions[i] === CONSTANTS.USER_ACTIONS.EXCLUDE ? true : l
    );

    // 2. Partition into explicit (override) and implicit (dynamic) groups
    let explicit = [],
      implicit = [];
    forcedQuals.forEach((q, i) => {
      if (actions[i] !== CONSTANTS.USER_ACTIONS.EXCLUDE) {
        if (forcedLocks[i] && q > 0) {
          explicit.push(i); // Only include locked workers with a percent > 0
        } else if (!forcedLocks[i]) {
          implicit.push(i);
        }
      }
    });

    let finalDist = new Array(origQuals.length).fill(0);
    let remainingPool = pool; // Track remaining tasks to distribute

    // 3. Compute total override percentage
    let totalOverridePercent = explicit.reduce(
      (sum, i) => sum + Number(forcedQuals[i]),
      0
    );

    // 4. Compute the dynamic pool and override pool
    let dynamicPool = 0;
    let overridePool = remainingPool;

    if (totalOverridePercent < 100) {
      dynamicPool = Math.floor(
        remainingPool * ((100 - totalOverridePercent) / 100)
      );

      // Ensure there's enough for dynamic workers
      let minDynamicRequired = implicit.length;
      if (dynamicPool < minDynamicRequired) {
        dynamicPool = minDynamicRequired;
        overridePool = remainingPool - minDynamicRequired;
      }

      // Assign at least 1 task to each dynamic worker
      implicit.forEach((i) => {
        finalDist[i] = 1;
        remainingPool--; // Reduce remaining pool
      });

      overridePool -= implicit.length - 1;

      // If dynamic pool still has extra tasks, distribute evenly among implicit workers
      if (dynamicPool > implicit.length) {
        let extraTasks = dynamicPool - implicit.length;
        let baseDynamic = Math.floor(extraTasks / implicit.length);
        let remainder = extraTasks % implicit.length;

        implicit.forEach((i, index) => {
          if (remainingPool > 0) {
            let allocation = baseDynamic + (index < remainder ? 1 : 0);
            finalDist[i] += allocation;
            remainingPool -= allocation;
          }
        });
      }
    } else {
      // If override total is 100%, implicit workers get 0 tasks
      implicit.forEach((i) => (finalDist[i] = 0));
    }

    // 5. Allocate override workers

    // First assign a minimum of 1 task to each override worker.
    explicit.forEach((i) => {
      if (remainingPool > 0) {
        finalDist[i] = 1;
        remainingPool--;
      }
    });

    // 6. Distribute remaining override pool proportionally
    if (remainingPool > 0) {
      let totalRemainingPercent = explicit.reduce(
        (sum, i) => sum + Number(forcedQuals[i]),
        0
      );

      explicit.forEach((i) => {
        if (totalRemainingPercent > 0 && remainingPool > 0) {
          let extraTasks = Math.floor(
            (forcedQuals[i] / totalRemainingPercent) * remainingPool
          );
          finalDist[i] += extraTasks;
          remainingPool -= extraTasks;
        }
      });

      // Adjust for rounding errors (ensuring total tasks match the pool)
      explicit.forEach((i) => {
        if (remainingPool > 0) {
          finalDist[i]++;
          remainingPool--;
        }
      });
      if (remainingPool > 0) {
        explicit.forEach((i) => {
          if (remainingPool > 0) {
            finalDist[i]++;
            remainingPool--;
          }
        });
      }
    }

    return { ...vals, [CONSTANTS.FIELD_KEYS.TO_ASSIGN]: finalDist };
  };

  // updateDistribution now accepts a pool value.
  const updateDistribution = (updatedValues, pool) => {
    const consolidated = consolidateValues(updatedValues, pool);
    setFieldValue(
      CONSTANTS.FIELD_KEYS.TO_ASSIGN,
      consolidated[CONSTANTS.FIELD_KEYS.TO_ASSIGN]
    );
  };

  // The qualifier onChange handler clamps input and updates distribution if a pool is applied.
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
    if (Number(values.globalChunk) > 0) {
      updateDistribution(updatedValues, Number(values.globalChunk));
    }
  };

  // Clamp the raw globalChunk input to be between 0 and baseAssignable.
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

  // On mount, reset qualifier locks and recalc percentages.
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
    // Do not update distribution here; wait until user applies a pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Apply Global Add button saves the current globalChunk value as the applied pool and updates distribution.
  const updateConsolidatedValues = () => {
    const newPool = Number(values.globalChunk);
    updateDistribution(values, newPool);
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
            max={baseAssignable}
            style={{ marginLeft: "5px", width: "60px" }}
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
            <th className="th">Pending Total</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, idx) => {
            const currentVal = Number(
              values[CONSTANTS.FIELD_KEYS.TO_ASSIGN][idx] || 0
            );
            let remaining = 0;
            if (
              values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
              CONSTANTS.USER_ACTIONS.ADD
            ) {
              const poolForAddition = Number(values.globalChunk);
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
            const computedValue = values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][
              idx
            ]
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
                    name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`}
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
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.QUALIFIER}[${idx}]`,
                          0
                        );
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                          true
                        );
                      }
                      if (Number(values.globalChunk) > 0) {
                        updateDistribution(values, Number(values.globalChunk));
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
                    <option value={CONSTANTS.USER_ACTIONS.ADD}>Add</option>
                    <option value={CONSTANTS.USER_ACTIONS.EXCLUDE}>
                      Exclude
                    </option>
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
                    <Field
                      name={`${CONSTANTS.FIELD_KEYS.QUALIFIER}[${idx}]`}
                      type="number"
                      onChange={(e) => handleQualifierChange(e, idx)}
                      value={
                        values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]
                          ? computedValue
                          : ""
                      }
                      placeholder={
                        !values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]
                          ? qualifierValue < 1 && remPercentVal > 0
                            ? "<1%"
                            : computedValue
                          : ""
                      }
                      style={{ width: "60px", padding: "5px" }}
                      readOnly={
                        values[CONSTANTS.FIELD_KEYS.ACTION][idx] ===
                        CONSTANTS.USER_ACTIONS.EXCLUDE
                      }
                    />
                    <Field
                      name={`${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`}
                      type="checkbox"
                      onChange={(e) => {
                        const newLocked = e.target.checked;
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED}[${idx}]`,
                          newLocked
                        );
                        const updatedValues = {
                          ...values,
                          [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: values[
                            CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED
                          ].map((val, i) => (i === idx ? newLocked : val)),
                          [CONSTANTS.FIELD_KEYS.QUALIFIER]: values[
                            CONSTANTS.FIELD_KEYS.QUALIFIER
                          ].map((q, i) =>
                            i === idx ? (newLocked ? computedValue : 0) : q
                          ),
                        };
                        CumulativePercent.recalc(updatedValues, setFieldValue);
                        updateDistribution(
                          updatedValues,
                          Number(values.globalChunk)
                        );
                      }}
                      checked={
                        values[CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED][idx]
                      }
                    />
                  </div>
                </td>

                <td className="td">
                  <Field
                    name={`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                    component={ControlledToAssignInput}
                    index={idx}
                    onValidatedChange={handleFieldChange}
                    readOnly={true}
                    style={{ width: "80px", padding: "5px" }}
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
              CONSTANTS.FIELD_KEYS.TO_ASSIGN,
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
                    name={`${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`}
                    value={values[CONSTANTS.FIELD_KEYS.ACTION][idx]}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setFieldValue(
                        `${CONSTANTS.FIELD_KEYS.ACTION}[${idx}]`,
                        newValue
                      );
                      const updatedValues = {
                        ...values,
                        [CONSTANTS.FIELD_KEYS.ACTION]: values[
                          CONSTANTS.FIELD_KEYS.ACTION
                        ].map((act, i) => (i === idx ? newValue : act)),
                      };
                      if (newValue === CONSTANTS.USER_ACTIONS.EXCLUDE) {
                        setFieldValue(
                          `${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                          0
                        );
                        recalcNPerUser(
                          updatedValues,
                          setFieldValue,
                          baseAssignable,
                          Number(values.perUserChunk) || 0
                        );
                      } else if (newValue === CONSTANTS.USER_ACTIONS.ADD) {
                        updatedValues[CONSTANTS.FIELD_KEYS.TO_ASSIGN] =
                          applyGlobalAddLogic(updatedValues, baseAssignable);
                        setFieldValue(
                          CONSTANTS.FIELD_KEYS.TO_ASSIGN,
                          updatedValues[CONSTANTS.FIELD_KEYS.TO_ASSIGN]
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
                    <option value={CONSTANTS.USER_ACTIONS.ADD}>Add</option>
                    <option value={CONSTANTS.USER_ACTIONS.EXCLUDE}>
                      Exclude
                    </option>
                  </Field>
                </td>
                <td className="td">
                  <Field
                    name={`${CONSTANTS.FIELD_KEYS.TO_ASSIGN}[${idx}]`}
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
        globalChunk: 10,
        [CONSTANTS.FIELD_KEYS.QUALIFIER]: users.map(() => 0),
        [CONSTANTS.FIELD_KEYS.QUALIFIER_LOCKED]: users.map(() => false),
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
