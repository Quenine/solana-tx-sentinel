import { getEnv } from "../config/env.js";
import { learnObservedJitoLeaders } from "../leaders/observed-jito-leaders.js";
import { createConnection } from "../solana/connection.js";

async function main(): Promise<void> {
  const env = getEnv();
  const connection = createConnection();
  const result = await learnObservedJitoLeaders({
    connection,
    outputPath: env.OBSERVED_JITO_LEADERS_PATH
  });

  console.log(`observed_leader_count=${result.observed_leader_count}`);

  for (const leader of result.leaders) {
    console.log(`${leader.leader} landing_count=${leader.landing_count}`);
  }

  if (result.notes.length > 0) {
    console.log(`notes=${result.notes.join(" ")}`);
  }

  console.log(`output_path=${env.OBSERVED_JITO_LEADERS_PATH}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown observed Jito leader learning error";
  console.error(message);
  process.exitCode = 1;
});
