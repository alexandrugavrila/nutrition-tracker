import { useMemo } from 'react';
import { useAccountClient } from '@/contexts/AccountScope';
import type { components } from '@/api-types';
import type { PlanPayload } from '@/utils/planningTypes';

type PlanRead = components['schemas']['PlanRead'];
type PlanCreate = components['schemas']['PlanCreate'];
type PlanUpdate = components['schemas']['PlanUpdate'];

export function usePlanApi() {
  const apiClient = useAccountClient();
  return useMemo(() => {
    async function fetchPlans(): Promise<PlanRead[]> {
      const { data } = (await apiClient.path('/api/plans/').method('get').create()({})) as {
        data: PlanRead[];
      };
      return data;
    }

    async function fetchPlan(planId: number): Promise<PlanRead> {
      const { data } = (await apiClient.path(`/api/plans/${planId}`).method('get').create()(
        {},
      )) as { data: PlanRead };
      return data;
    }

    async function createPlan(label: string, payload: PlanPayload): Promise<PlanRead> {
      const body: PlanCreate = { label, payload };
      const { data } = (await apiClient.path('/api/plans/').method('post').create()({ body })) as {
        data: PlanRead;
      };
      return data;
    }

    async function updatePlan(
      planId: number,
      { label, payload }: { label?: string; payload?: PlanPayload },
    ): Promise<PlanRead> {
      const body: PlanUpdate = {};
      if (label !== undefined) {
        body.label = label;
      }
      if (payload !== undefined) {
        body.payload = payload;
      }
      const { data } = (await apiClient.path(`/api/plans/${planId}`).method('put').create()({
        body,
      })) as { data: PlanRead };
      return data;
    }

    async function deletePlan(planId: number): Promise<void> {
      await apiClient.path(`/api/plans/${planId}`).method('delete').create()({});
    }

    return { fetchPlans, fetchPlan, createPlan, updatePlan, deletePlan };
  }, [apiClient]);
}

export type { PlanRead };
