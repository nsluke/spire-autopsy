import { handleContributeRequest, type ContributeEnv } from '../../contribute-ingest/handler';

interface PagesContext {
  request: Request;
  env: ContributeEnv;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleContributeRequest(context.request, context.env);
}
