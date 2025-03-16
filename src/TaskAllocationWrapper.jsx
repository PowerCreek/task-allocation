// TaskAllocationWrapper.jsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import TaskAllocationForm from "./TaskAllocation";

// In-memory store that persists across updates.
let taskStore = {
  assignableTasks: 120,
  users: [
    { id: 1, name: "Alice", tasks: 3 },
    { id: 2, name: "Bob", tasks: 5 },
    { id: 3, name: "Charlie", tasks: 2 },
    { id: 4, name: "David", tasks: 4 },
    { id: 5, name: "Eve", tasks: 1 },
    { id: 6, name: "Kev", tasks: 1 },
  ],
};

// Simulated asynchronous fetch for the current task store.
const fetchTaskStore = async () => {
  // Simulate network delay (e.g., fetching from an API)
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

const TaskAllocationWrapper = () => {
  const queryClient = useQueryClient();

  // Remove initialData so that the query always fetches fresh data.
  const { data, isLoading } = useQuery({
    queryKey: ["taskStore"],
    queryFn: fetchTaskStore,
    // Optionally, enforce fetching on mount:
    refetchOnMount: true,
    staleTime: 0,
    initialData: {
      assignableTasks: 0,
      users: [],
      isLoaded: false,
    },
  });

  // Show a loading state until the data is fetched.

  // Callback invoked by TaskAllocationForm to update the repository.
  const handleUpdateInitialStore = async (newStore) => {
    console.log("Updating store with:", newStore);
    // Update the in-memory store.
    const updatedStore = await updateTaskStore(newStore);
    // Immediately update the query cache with the new value.
    queryClient.setQueryData(["taskStore"], updatedStore);
  };

  return (
    <div>
      <TaskAllocationForm
        initialStore={data}
        onUpdateInitialStore={handleUpdateInitialStore}
      />
    </div>
  );
};

export default TaskAllocationWrapper;
