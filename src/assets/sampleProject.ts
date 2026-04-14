/**
 * sampleProject.ts — built-in demo project loaded on first run.
 *
 * The JSON file is imported as a URL (Vite asset) so it isn't inlined into
 * the bundle.  getSampleProjectFile() fetches it lazily and returns a File
 * that loadProject() can consume directly.
 */

import sampleUrl from './sample_project.json?url';

/** Fetches the bundled sample project and returns it as a File. */
export async function getSampleProjectFile(): Promise<File> {
  const res = await fetch(sampleUrl);
  const blob = await res.blob();
  return new File([blob], 'sample.json', { type: 'application/json' });
}
