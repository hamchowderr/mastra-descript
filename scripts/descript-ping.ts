import { env } from '../src/lib/env';
import { DescriptClient } from '../src/mastra/lib/descript-client';

async function main() {
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  try {
    const status = await client.healthcheck();
    console.log(
      `✓ Descript API is reachable and the API token is valid.${status.api_version ? ` (api_version ${status.api_version})` : ''}`,
    );
    process.exit(0);
  } catch (err) {
    console.error('✗ Descript API check failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
