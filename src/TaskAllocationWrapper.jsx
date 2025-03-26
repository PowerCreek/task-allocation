// TaskAllocationWrapper.jsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import "./App.css";
import TaskAllocationForm from "./TaskAllocation";

// A simple function to generate fake work items
const generateFakeWorkItem = (_, index) => {
  // We generate a random UUID string, a random customer first name, a timestamp, and a random screen type.
  const uuid = Math.random().toString(36).substring(2, 10) + "-" + Date.now();
  const fakeNames = ["John", "Mary", "Alex", "Sara", "Tom", "Lily"];
  const customerFirstName =
    fakeNames[Math.floor(Math.random() * fakeNames.length)];
  const generatedAt = new Date().toISOString();
  const screenTypes = [
    "Good Report",
    "Bad Report",
    "Meritorious",
    "HR Tracking",
  ];
  const screenType =
    screenTypes[Math.floor(Math.random() * screenTypes.length)];

  return { uuid, customerFirstName, generatedAt, screenType };
};

// In-memory task store with users and work items.
let taskStore = {
  assignableTasks: 120,
  users: [
    {
      id: 1,
      name: "Alice",
      tasks: Array.from({ length: 3 }, generateFakeWorkItem),
    },
    {
      id: 2,
      name: "Bob",
      tasks: Array.from({ length: 5 }, generateFakeWorkItem),
    },
    {
      id: 3,
      name: "Charlie",
      tasks: Array.from({ length: 2 }, generateFakeWorkItem),
    },
    {
      id: 4,
      name: "David",
      tasks: Array.from({ length: 4 }, generateFakeWorkItem),
    },
    {
      id: 5,
      name: "Eve",
      tasks: Array.from({ length: 1 }, generateFakeWorkItem),
    },
    {
      id: 6,
      name: "Kev",
      tasks: Array.from({ length: 1 }, generateFakeWorkItem),
    },
  ],
  // Global list of all work items.
  allTasks: Array.from({ length: 30 }, generateFakeWorkItem),
};

// Simulated asynchronous fetch for the current task store.
const fetchTaskStore = async () => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { isLoaded: true, ...taskStore };
};

// Simulated asynchronous update command that modifies the task store.
const updateTaskStore = async (newStore) => {
  // Merge the new properties into the existing store.
  taskStore = { ...taskStore, ...newStore, isLoaded: true };
  // Simulate network delay for the update.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return taskStore;
};

// A simple datatable component for work items.
const TasksDataTable = ({ tasks }) => {
  return (
    <div className="tasks-datatable">
      <h3>All Work Items</h3>
      <table className="table">
        <thead>
          <tr>
            <th>UUID</th>
            <th>Customer First Name</th>
            <th>Generated At</th>
            <th>Screen Type</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.uuid}>
              <td>{task.uuid}</td>
              <td>{task.customerFirstName}</td>
              <td>{task.generatedAt}</td>
              <td>{task.screenType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TaskAllocationWrapper = () => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["taskStore"],
    queryFn: fetchTaskStore,
    refetchOnMount: true,
    staleTime: 0,
    initialData: {
      assignableTasks: 0,
      users: [],
      isLoaded: false,
      allTasks: [],
    },
  });

  // Callback invoked by TaskAllocationForm to update the store.
  const handleUpdateInitialStore = async (newStore) => {
    console.log("Updating store with:", newStore);
    const updatedStore = await updateTaskStore(newStore);
    queryClient.setQueryData(["taskStore"], updatedStore);
  };

  // If still loading, show a loading message.
  if (isLoading || !data.isLoaded) {
    return <div>Loading task store...</div>;
  }

  // We pass the entire store to TaskAllocationForm.
  // Later you could filter or select a subset of tasks and pass them as props.
  return (
    <div>
      <TaskAllocationForm
        initialStore={data}
        onUpdateInitialStore={handleUpdateInitialStore}
      />
      <hr />
      <TasksDataTable tasks={data.allTasks} />
    </div>
  );
};

export default TaskAllocationWrapper;
