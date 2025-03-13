// taskAllocationHelpers.js

export const ALLOCATION_MODES = {
  NORMAL: "normal",
  DISTRIBUTED: "distributed",
};

export const USER_ACTIONS = {
  ADD: "add",
  SUBTRACT: "subtract",
  EXCLUDE: "exclude",
};

export const FIELD_KEYS = {
  TO_ASSIGN: "toAssign",
  ACTION: "action",
  ALLOCATION_MODE: "allocationMode",
  GLOBAL_ADD_MODE: "globalAddMode",
  PER_USER_CHUNK: "perUserChunk",
  GLOBAL_CHUNK: "globalChunk",
};

// Helper functions

export const calcUpdatedUsers = (values, users) =>
  users.map((user, idx) => {
    const delta = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
    const action = values[FIELD_KEYS.ACTION][idx];
    switch (action) {
      case USER_ACTIONS.ADD:
        return { ...user, tasks: user.tasks + delta };
      case USER_ACTIONS.SUBTRACT:
        return { ...user, tasks: Math.max(0, user.tasks - delta) };
      default:
        return user;
    }
  });

export const calcTotals = (values) =>
  values[FIELD_KEYS.TO_ASSIGN].reduce(
    (acc, val, idx) => {
      switch (values[FIELD_KEYS.ACTION][idx]) {
        case USER_ACTIONS.ADD:
          acc.totalAdded += Number(val);
          break;
        case USER_ACTIONS.SUBTRACT:
          acc.totalSubtracted += Number(val);
          break;
        default:
          break;
      }
      return acc;
    },
    { totalAdded: 0, totalSubtracted: 0 }
  );

export const calcEffectivePool = (baseAssignable, values) => {
  const { totalAdded, totalSubtracted } = calcTotals(values);
  return Math.max(0, baseAssignable + totalSubtracted - totalAdded);
};

export const disableSelect = (
  values,
  idx,
  totals,
  baseAssignable,
  userTasks
) => {
  if (values[FIELD_KEYS.ALLOCATION_MODE] !== ALLOCATION_MODES.NORMAL)
    return false;
  const currentVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
  let oppositeMin, oppositeMax;
  switch (values[FIELD_KEYS.ACTION][idx]) {
    case USER_ACTIONS.ADD:
      oppositeMin = Math.max(
        0,
        totals.totalAdded - currentVal - baseAssignable - totals.totalSubtracted
      );
      oppositeMax = userTasks;
      break;
    case USER_ACTIONS.SUBTRACT:
      oppositeMin = 0;
      oppositeMax =
        baseAssignable +
        totals.totalSubtracted -
        currentVal -
        totals.totalAdded;
      break;
    default:
      oppositeMin = 0;
      oppositeMax = 0;
  }
  return currentVal < oppositeMin || currentVal > oppositeMax;
};

export const adjustValue = (
  action,
  newVal,
  oldVal,
  totals,
  newTotals,
  poolForAddition,
  userTasks
) => {
  switch (action) {
    case USER_ACTIONS.ADD:
      return newTotals.totalAdded > poolForAddition
        ? Math.max(0, newVal - (newTotals.totalAdded - poolForAddition))
        : newVal;
    case USER_ACTIONS.SUBTRACT: {
      // Check if effective pool is zero: if so, no changes should occur.
      if (poolForAddition < totals.totalAdded) {
        return oldVal;
      }
      const clampedVal = Math.min(newVal, userTasks);
      const currentSubtracted = totals.totalSubtracted - oldVal;
      const subtractMin = Math.max(0, totals.totalAdded - poolForAddition);
      return clampedVal < subtractMin ? subtractMin : clampedVal;
    }
    default:
      return 0;
  }
};

export const applyGlobalAddLogic = (values, baseAssignable) => {
  const poolToDistribute = baseAssignable;
  const { globalAddMode, perUserChunk, globalChunk, action, toAssign } = values;
  const applicableIndices = action
    .map((act, idx) => (act === USER_ACTIONS.ADD ? idx : null))
    .filter((idx) => idx !== null);
  let newToAssign = [...toAssign];

  if (globalAddMode === "perUser") {
    const chunk = Number(perUserChunk) || 0;
    let remaining = poolToDistribute;
    applicableIndices.forEach((idx) => {
      newToAssign[idx] = remaining > chunk ? chunk : remaining;
      remaining -= Math.min(chunk, remaining);
    });
  } else if (globalAddMode === "evenly") {
    if (applicableIndices.length >= 0) {
      const eligibleCount = applicableIndices.length;
      const share = Math.floor(poolToDistribute / eligibleCount);
      const allocation = Math.min(share, Number(globalChunk) || share);
      applicableIndices.forEach((idx) => {
        newToAssign[idx] = allocation;
      });
    }
  }
  return newToAssign;
};
