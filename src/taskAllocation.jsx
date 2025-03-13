// taskAllocation.jsx

import { Field, Form, Formik } from "formik";
import React, { useState } from "react";
import "./App.css";
import {
  ALLOCATION_MODES,
  FIELD_KEYS,
  USER_ACTIONS,
  adjustValue,
  applyGlobalAddLogic,
  calcEffectivePool,
  calcTotals,
  calcUpdatedUsers,
  disableSelect,
} from "./taskAllocationHelpers";

const initialStore = {
  assignableTasks: 20,
  users: [
    { id: 1, name: "Alice", tasks: 3 },
    { id: 2, name: "Bob", tasks: 5 },
    { id: 3, name: "Charlie", tasks: 2 },
    { id: 4, name: "David", tasks: 4 },
    { id: 5, name: "Eve", tasks: 1 },
  ],
};

export const TaskAllocationForm = () => {
  const [assignable, setAssignable] = useState(initialStore.assignableTasks);
  const [users, setUsers] = useState(initialStore.users);
  const [baseAssignable] = useState(assignable);

  // Updated field change handler: invalid or negative values are clamped,
  // but we do not trigger global recalculation automatically.
  const handleFieldChange = (e, idx, values, setFieldValue) => {
    const action = values[FIELD_KEYS.ACTION][idx];
    const { value } = e.target;
    const numericValue = parseFloat(value);
    // If the input is invalid (e.g. empty string) we treat it as 0.
    const newValRaw = isNaN(numericValue) ? 0 : Math.max(0, numericValue);
    const oldVal = Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0);
    const updatedToAssign = [...values[FIELD_KEYS.TO_ASSIGN]];
    updatedToAssign[idx] = newValRaw;

    const totals = calcTotals(values);
    const newTotals = calcTotals({
      [FIELD_KEYS.TO_ASSIGN]: updatedToAssign,
      action: values[FIELD_KEYS.ACTION],
    });
    const poolForAddition =
      values[FIELD_KEYS.ALLOCATION_MODE] === ALLOCATION_MODES.DISTRIBUTED
        ? baseAssignable
        : baseAssignable + newTotals.totalSubtracted;
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
    // No automatic global recalculation is triggered here.
  };

  const handleSubmit = (
    values,
    { setSubmitting, setFieldValue, resetForm }
  ) => {
    const updatedUsers = calcUpdatedUsers(values, users);
    setUsers(updatedUsers);
    initialStore.users = updatedUsers;

    const totals = calcTotals(values);
    const updatedAssignable =
      values[FIELD_KEYS.ALLOCATION_MODE] === ALLOCATION_MODES.DISTRIBUTED
        ? baseAssignable
        : Math.max(
            0,
            baseAssignable + totals.totalSubtracted - totals.totalAdded
          );
    initialStore.assignableTasks = updatedAssignable;
    setAssignable(updatedAssignable);

    // Reset only the per-row fields (toAssign and action), preserving the current mode.
    values[FIELD_KEYS.TO_ASSIGN].forEach((_, idx) => {
      setFieldValue(`${FIELD_KEYS.TO_ASSIGN}[${idx}]`, 0);
      setFieldValue(`${FIELD_KEYS.ACTION}[${idx}]`, USER_ACTIONS.ADD);
    });
    setSubmitting(false);
  };

  return (
    <Formik
      enableReinitialize
      initialValues={{
        [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
        [FIELD_KEYS.ACTION]: users.map(() => USER_ACTIONS.ADD),
        [FIELD_KEYS.ALLOCATION_MODE]: ALLOCATION_MODES.NORMAL,
        [FIELD_KEYS.GLOBAL_ADD_MODE]: "perUser",
        perUserChunk: 0,
        globalChunk: 10,
      }}
      onSubmit={handleSubmit}
    >
      {({ values, setFieldValue, setValues, resetForm }) => {
        const poolForAddition =
          values[FIELD_KEYS.ALLOCATION_MODE] === ALLOCATION_MODES.DISTRIBUTED
            ? baseAssignable
            : baseAssignable + calcTotals(values).totalSubtracted;
        const effectivePool = calcEffectivePool(baseAssignable, values);
        const totals = calcTotals(values);

        return (
          <Form className="container">
            <style>{`
              /* Light Mode Styles */
              .container {
                margin: 20px;
                font-family: Arial, sans-serif;
                background-color: #f5f5f5;
                color: #2c3e50;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 8px;
              }
              h3 {
                margin-bottom: 10px;
                font-size: 22px;
                font-weight: bold;
                color: #1a73e8;
              }
              .section {
                margin-bottom: 15px;
              }
              .label {
                margin-right: 10px;
                font-weight: bold;
                color: #34495e;
              }
              .table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 15px;
                background-color: #ecf0f3;
                border-radius: 8px;
                overflow: hidden;
              }
              .th, .td {
                box-shadow: inset 0 0 0 2px lightgray;
                padding: 10px;
                text-align: center;
              }
              .th {
                background-color: #b0c4de;
                color: #2c3e50;
                font-weight: bold;
              }
              .button {
                padding: 7px 12px;
                margin: 3px;
                cursor: pointer;
                background-color: #1a73e8;
                color: white;
                border: none;
                border-radius: 5px;
                transition: background-color 0.3s ease;
              }
              .button:hover {
                background-color: #1558b0;
              }
              select, input {
                padding: 6px;
                border: 1px solid #bdc3c7;
                border-radius: 5px;
                background-color: #dfe6e9;
                color: #2c3e50;
                font-size: 14px;
                cursor: pointer;
              }
              select {
                appearance: none;
                -webkit-appearance: none;
                -moz-appearance: none;
              }
              select option {
                padding: 5px;
              }
              input:focus, select:focus {
                outline: none;
                border-color: #1a73e8;
                box-shadow: 0 0 5px rgba(26, 115, 232, 0.5);
              }
              /* Dark Mode Styles */
              @media (prefers-color-scheme: dark) {
                .container {
                  background-color: #1e1e1e;
                  color: #f0f0f0;
                  border: 1px solid #444;
                }
                h3 {
                  color: #ffa500;
                }
                label {
                  color: #f0f0f0;
                }
                .table {
                  background-color: #2a2a2a;
                }
                .th, .td {
                  box-shadow: inset 0 0 0 2px #555;
                  color: #f0f0f0;
                }
                .th {
                  background-color: #3a3a3a;
                }
                .button {
                  background-color: #ff8c00;
                  color: #1e1e1e;
                  border: none;
                  border-radius: 4px;
                }
                .button:hover {
                  background-color: #e07b00;
                }
                select, input {
                  background-color: #2a2a2a;
                  color: #f0f0f0;
                  border: 1px solid #666;
                }
                input:focus, select:focus {
                  border-color: #ff8c00;
                  box-shadow: 0 0 5px rgba(255, 140, 0, 0.5);
                }
                select option {
                  padding: 5px;
                }
              }
              /* Flex Row for Distribution Controls */
              .distribution-controls {
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                align-items: center;
              }
              .distribution-group {
                display: flex;
                flex-direction: row;
                align-items: center;
              }
              /* Flex Row for Info Elements */
              .info-row {
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
              }
            `}</style>

            <div className="section">
              <h3>Allocation Mode</h3>
              <label className="label">
                Mode:
                <Field name={FIELD_KEYS.ALLOCATION_MODE}>
                  {({ field, form }) => (
                    <select
                      {...field}
                      onChange={(e) => {
                        // When switching allocation modes, reset per-row fields.
                        switch (e.target.value) {
                          case ALLOCATION_MODES.NORMAL:
                          case ALLOCATION_MODES.DISTRIBUTED:
                            form.resetForm({
                              values: {
                                ...form.values,
                                [FIELD_KEYS.ALLOCATION_MODE]: e.target.value,
                                [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                                [FIELD_KEYS.ACTION]: users.map(
                                  () => USER_ACTIONS.ADD
                                ),
                              },
                            });
                            break;
                          default:
                            break;
                        }
                      }}
                      style={{ marginLeft: "5px" }}
                    >
                      <option value={ALLOCATION_MODES.NORMAL}>
                        Normal Allocation
                      </option>
                      <option value={ALLOCATION_MODES.DISTRIBUTED}>
                        Distributed Allocation
                      </option>
                    </select>
                  )}
                </Field>
              </label>
            </div>

            {values[FIELD_KEYS.ALLOCATION_MODE] ===
              ALLOCATION_MODES.DISTRIBUTED && (
              <div className="section distribution-controls">
                <div className="distribution-group">
                  <h3 style={{ marginRight: "10px" }}>
                    Global Add Distribution (Base Pool: {baseAssignable})
                  </h3>
                  <label className="label">
                    Distribution Mode:
                    <Field
                      as="select"
                      name={FIELD_KEYS.GLOBAL_ADD_MODE}
                      onChange={(e) => {
                        // When switching distribution mode, reset per-row fields.
                        switch (e.target.value) {
                          case "perUser":
                          case "evenly":
                            setValues({
                              ...values,
                              [FIELD_KEYS.GLOBAL_ADD_MODE]: e.target.value,
                              [FIELD_KEYS.TO_ASSIGN]: users.map(() => 0),
                              [FIELD_KEYS.ACTION]: users.map(
                                () => USER_ACTIONS.ADD
                              ),
                            });
                            break;
                          default:
                            break;
                        }
                      }}
                      style={{ marginLeft: "5px" }}
                    >
                      <option value="perUser">N per user</option>
                      <option value="evenly">Evenly Distributed</option>
                    </Field>
                  </label>
                  {values[FIELD_KEYS.GLOBAL_ADD_MODE] === "perUser" && (
                    <label className="label" style={{ marginLeft: "10px" }}>
                      Per User Chunk:
                      <Field
                        type="number"
                        name="perUserChunk"
                        style={{ marginLeft: "5px", width: "60px" }}
                      />
                    </label>
                  )}
                  {values[FIELD_KEYS.GLOBAL_ADD_MODE] === "evenly" && (
                    <label className="label" style={{ marginLeft: "10px" }}>
                      Global Chunk (Cap per User):
                      <Field
                        type="number"
                        name="globalChunk"
                        min="0"
                        style={{ marginLeft: "5px", width: "60px" }}
                      />
                    </label>
                  )}
                </div>
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
            )}

            <div className="section info-row">
              <div>
                <strong>Effective Pool:</strong> {effectivePool}
              </div>
              <div>
                <strong>Total Allocated (Add):</strong> {totals.totalAdded} /{" "}
                {poolForAddition}
              </div>
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
                    values[FIELD_KEYS.TO_ASSIGN][idx] || 0
                  );
                  let remaining = 0;
                  switch (values[FIELD_KEYS.ACTION][idx]) {
                    case USER_ACTIONS.ADD: {
                      const addMax =
                        poolForAddition - (totals.totalAdded - currentVal);
                      remaining = Math.max(0, addMax - currentVal);
                      break;
                    }
                    case USER_ACTIONS.SUBTRACT: {
                      remaining = user.tasks - currentVal;
                      break;
                    }
                    default:
                      remaining = 0;
                  }
                  let pendingTotal = user.tasks;
                  switch (values[FIELD_KEYS.ACTION][idx]) {
                    case USER_ACTIONS.ADD:
                      pendingTotal = user.tasks + currentVal;
                      break;
                    case USER_ACTIONS.SUBTRACT:
                      pendingTotal = Math.max(0, user.tasks - currentVal);
                      break;
                    default:
                      pendingTotal = user.tasks;
                  }
                  return (
                    <tr key={user.id}>
                      <td className="td">{user.name}</td>
                      <td className="td">{user.tasks}</td>
                      <td className="td">
                        <Field
                          as="select"
                          name={`${FIELD_KEYS.ACTION}[${idx}]`}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            setFieldValue(
                              `${FIELD_KEYS.ACTION}[${idx}]`,
                              newValue
                            );
                            const updatedValues = {
                              ...values,
                              [FIELD_KEYS.ACTION]: values[
                                FIELD_KEYS.ACTION
                              ].map((act, i) => (i === idx ? newValue : act)),
                            };
                            switch (newValue) {
                              case USER_ACTIONS.EXCLUDE:
                                updatedValues[FIELD_KEYS.TO_ASSIGN] = values[
                                  FIELD_KEYS.TO_ASSIGN
                                ].map((amt, i) => (i === idx ? 0 : amt));
                                setFieldValue(
                                  FIELD_KEYS.TO_ASSIGN,
                                  applyGlobalAddLogic(
                                    updatedValues,
                                    baseAssignable
                                  )
                                );
                                break;
                              case USER_ACTIONS.ADD:
                                if (
                                  values[FIELD_KEYS.GLOBAL_ADD_MODE] ===
                                  "perUser"
                                ) {
                                  updatedValues[FIELD_KEYS.TO_ASSIGN] = values[
                                    FIELD_KEYS.TO_ASSIGN
                                  ].map((amt, i) =>
                                    i === idx ? values.perUserChunk : amt
                                  );
                                  setFieldValue(
                                    `${FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                                    values.perUserChunk
                                  );
                                } else {
                                  updatedValues[FIELD_KEYS.TO_ASSIGN] =
                                    applyGlobalAddLogic(
                                      updatedValues,
                                      baseAssignable
                                    );
                                  setFieldValue(
                                    FIELD_KEYS.TO_ASSIGN,
                                    updatedValues[FIELD_KEYS.TO_ASSIGN]
                                  );
                                }
                                break;
                              default:
                                break;
                            }
                          }}
                          disabled={
                            values[FIELD_KEYS.ALLOCATION_MODE] ===
                            ALLOCATION_MODES.NORMAL
                              ? disableSelect(
                                  values,
                                  idx,
                                  totals,
                                  baseAssignable,
                                  user.tasks
                                )
                              : false
                          }
                          style={{ width: "100px", padding: "5px" }}
                        >
                          {values[FIELD_KEYS.ALLOCATION_MODE] ===
                          ALLOCATION_MODES.DISTRIBUTED ? (
                            <>
                              <option value={USER_ACTIONS.ADD}>Add</option>
                              <option value={USER_ACTIONS.EXCLUDE}>
                                Exclude
                              </option>
                            </>
                          ) : (
                            <>
                              <option value={USER_ACTIONS.ADD}>Add</option>
                              <option value={USER_ACTIONS.SUBTRACT}>
                                Subtract
                              </option>
                            </>
                          )}
                        </Field>
                      </td>
                      <td className="td">
                        <Field
                          type="number"
                          name={`${FIELD_KEYS.TO_ASSIGN}[${idx}]`}
                          value={values[FIELD_KEYS.TO_ASSIGN][idx]}
                          onChange={(e) =>
                            handleFieldChange(e, idx, values, setFieldValue)
                          }
                          readOnly={
                            values[FIELD_KEYS.ALLOCATION_MODE] ===
                            ALLOCATION_MODES.DISTRIBUTED
                          }
                          style={{ width: "80px", padding: "5px" }}
                        />
                      </td>
                      <td className="td">
                        {values[FIELD_KEYS.ALLOCATION_MODE] ===
                        ALLOCATION_MODES.NORMAL ? (
                          <button
                            type="button"
                            onClick={() =>
                              setFieldValue(
                                `${FIELD_KEYS.TO_ASSIGN}[${idx}]`,
                                Number(values[FIELD_KEYS.TO_ASSIGN][idx] || 0) +
                                  remaining
                              )
                            }
                            className="button"
                          >
                            {remaining}
                          </button>
                        ) : (
                          remaining
                        )}
                      </td>
                      <td className="td">{pendingTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              type="submit"
              className="button mt-4"
              disabled={totals.totalAdded > poolForAddition}
            >
              Submit
            </button>
          </Form>
        );
      }}
    </Formik>
  );
};

export default TaskAllocationForm;
