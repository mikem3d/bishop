import * as core from '@bishop/core';
import type { TaskPatch, TaskWithContext, Uuid } from '@bishop/core';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';

// Every screen reads through these hooks. Live updates from Supabase
// invalidate the matching queries, so all screens stay current.

export const keys = {
  workspace: ['workspace'] as const,
  tasks: ['tasks'] as const,
  task: (id: Uuid) => ['task', id] as const,
  projectTasks: (id: Uuid) => ['projectTasks', id] as const,
  buckets: ['buckets'] as const,
  projects: ['projects'] as const,
  project: (id: Uuid) => ['project', id] as const,
  events: (id: Uuid) => ['events', id] as const,
  links: (id: Uuid) => ['links', id] as const,
  agents: ['agents'] as const,
};

export const useWorkspace = () =>
  useQuery({ queryKey: keys.workspace, queryFn: () => core.getWorkspace(supabase), staleTime: Infinity });

export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: () => core.listTasks(supabase) });
export const useTask = (id: Uuid) => useQuery({ queryKey: keys.task(id), queryFn: () => core.getTask(supabase, id) });
export const useProjectTasks = (id: Uuid) =>
  useQuery({ queryKey: keys.projectTasks(id), queryFn: () => core.listProjectTasks(supabase, id) });
export const useBuckets = () => useQuery({ queryKey: keys.buckets, queryFn: () => core.listBuckets(supabase) });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => core.listProjects(supabase) });
export const useProject = (id: Uuid) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => core.getProject(supabase, id) });
export const useTaskEvents = (id: Uuid) =>
  useQuery({ queryKey: keys.events(id), queryFn: () => core.listTaskEvents(supabase, id) });
export const useTaskLinks = (id: Uuid) =>
  useQuery({ queryKey: keys.links(id), queryFn: () => core.listTaskLinks(supabase, id) });
export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: () => core.listAgents(supabase) });

function invalidateTasks(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.tasks });
  void qc.invalidateQueries({ queryKey: ['task'] });
  void qc.invalidateQueries({ queryKey: ['projectTasks'] });
}

/** Subscribe once, near the root, to live changes from any device or agent. */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return core.subscribeToChanges(supabase, (table) => {
      switch (table) {
        case 'tasks':
          invalidateTasks(qc);
          break;
        case 'task_events':
          void qc.invalidateQueries({ queryKey: ['events'] });
          break;
        case 'task_links':
          void qc.invalidateQueries({ queryKey: ['links'] });
          break;
        case 'projects':
          void qc.invalidateQueries({ queryKey: keys.projects });
          void qc.invalidateQueries({ queryKey: ['project'] });
          invalidateTasks(qc);
          break;
        case 'buckets':
          void qc.invalidateQueries({ queryKey: keys.buckets });
          invalidateTasks(qc);
          break;
        case 'agents':
          void qc.invalidateQueries({ queryKey: keys.agents });
          break;
        case 'project_links':
          void qc.invalidateQueries({ queryKey: keys.projects });
          break;
      }
    });
  }, [enabled, qc]);
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Update a task, applying the change on screen immediately. */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Uuid; patch: TaskPatch }) => core.updateTask(supabase, id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const prev = qc.getQueryData<TaskWithContext[]>(keys.tasks);
      const now = new Date().toISOString();
      const apply = (t: TaskWithContext): TaskWithContext =>
        t.id !== id
          ? t
          : {
              ...t,
              ...patch,
              updated_at: now,
              completed_at: patch.status === 'done' ? now : patch.status ? null : t.completed_at,
            };
      if (prev) qc.setQueryData(keys.tasks, prev.map(apply));
      const one = qc.getQueryData<TaskWithContext>(keys.task(id));
      if (one) qc.setQueryData(keys.task(id), apply(one));
      return { prev, one };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.tasks, ctx.prev);
      if (ctx?.one) qc.setQueryData(keys.task(id), ctx.one);
    },
    onSettled: () => invalidateTasks(qc),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: core.NewTask) => core.createTask(supabase, input),
    onSettled: () => invalidateTasks(qc),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Uuid) => core.deleteTask(supabase, id),
    onSettled: () => invalidateTasks(qc),
  });
}

export function useCreateBucket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspace_id: Uuid; name: string; color?: string }) => core.createBucket(supabase, input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.buckets }),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspace_id: Uuid; bucket_id: Uuid; name: string }) => core.createProject(supabase, input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Uuid; patch: Parameters<typeof core.updateProject>[2] }) =>
      core.updateProject(supabase, id, patch),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: ['project'] });
      invalidateTasks(qc);
    },
  });
}

export function useAddComment(taskId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspace_id: Uuid; body: string; kind?: 'comment' | 'answer' }) =>
      core.addComment(supabase, { ...input, task_id: taskId }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.events(taskId) }),
  });
}

export function useAddLink(taskId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspace_id: Uuid; url: string }) =>
      core.addTaskLink(supabase, { ...input, task_id: taskId }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.links(taskId) }),
  });
}

export function useDeleteLink(taskId: Uuid) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Uuid) => core.deleteTaskLink(supabase, id),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.links(taskId) }),
  });
}

export function useUnlinkProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: Uuid) => core.unlinkProject(supabase, projectId),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}
