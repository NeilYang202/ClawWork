import simpleGit from 'simple-git';
import { basename } from 'path';

export async function commitArtifact(workspacePath: string, localPath: string, message?: string): Promise<string> {
  const git = simpleGit(workspacePath);

  await git.add(localPath);

  const status = await git.status();
  if (status.staged.length === 0) {
    return '';
  }

  const fileName = basename(localPath);
  const commitMessage = message ?? `artifact: ${fileName}`;
  const result = await git.commit(commitMessage);

  return result.commit || '';
}
