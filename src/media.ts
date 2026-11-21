import { currentContext } from './workspace';

/** Never render a private attachment URL before the workspace is verified. */
export function mediaUrl(path: string, download = false): string {
  const context = currentContext();
  return `/api/${download ? 'download' : 'attachment'}?path=${encodeURIComponent(path)}&context=${encodeURIComponent(JSON.stringify(context))}`;
}
