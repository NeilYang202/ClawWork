import { create } from 'zustand';
import type { Artifact } from '@clawwork/shared';

/** Stable empty array — avoids new references on every selector call */
const EMPTY_ARTIFACTS: Artifact[] = [];
export { EMPTY_ARTIFACTS };

type SortBy = 'date' | 'name' | 'type';

interface FileState {
  artifacts: Artifact[];
  /** null = all tasks, string = specific taskId */
  filterTaskId: string | null;
  sortBy: SortBy;
  selectedArtifactId: string | null;
  searchQuery: string;

  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;
  setFilterTaskId: (taskId: string | null) => void;
  setSortBy: (sortBy: SortBy) => void;
  setSelectedArtifact: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useFileStore = create<FileState>((set) => ({
  artifacts: [],
  filterTaskId: null,
  sortBy: 'date',
  selectedArtifactId: null,
  searchQuery: '',

  setArtifacts: (artifacts) => set({ artifacts }),

  addArtifact: (artifact) => set((s) => ({ artifacts: [artifact, ...s.artifacts] })),

  setFilterTaskId: (taskId) => set({ filterTaskId: taskId }),

  setSortBy: (sortBy) => set({ sortBy }),

  setSelectedArtifact: (id) => set({ selectedArtifactId: id }),

  setSearchQuery: (query) => set({ searchQuery: query }),
}));
