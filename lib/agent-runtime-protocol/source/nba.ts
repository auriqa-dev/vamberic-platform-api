import { RuntimeImplementationManifestSchema } from './work-v2.ts';
import { digest } from './json.ts';
const fields = {
  implementation: { key: 'nba_foundation', version: 1 },
  compatibleDefinitions: [{ key: 'next_best_action', version: 1 }],
  protocolVersions: ['2.0' as const],
  operations: ['reconsider'],
  resultSchemaVersions: [2],
  checkpointSchemaVersions: [2],
  instruction: {
    version: 1,
    hash: digest(
      'NBA wake-up: controller-authorised wake-up, yield until due, return re-evaluation request; never execute outreach.',
    ),
  },
  buildDigest: digest('nba_foundation_v1_controller_authorised_wakeup'),
};
export const NBA_FOUNDATION_MANIFEST =
  RuntimeImplementationManifestSchema.parse({
    ...fields,
    manifestDigest: digest(fields),
  });
