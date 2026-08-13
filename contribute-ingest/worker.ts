import { handleContributeRequest, type ContributeEnv } from './handler';

export default {
  async fetch(request: Request, env: ContributeEnv): Promise<Response> {
    return handleContributeRequest(request, env);
  },
};
