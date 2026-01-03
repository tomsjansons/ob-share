import { db } from "./index";
import { allowList } from "./schema";

// Seed the allow list with initial users
const initialAllowList = ["tomsjansons"];

async function seed() {
  console.log("Seeding database...");

  for (const username of initialAllowList) {
    try {
      await db
        .insert(allowList)
        .values({
          githubUsername: username,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      console.log(`Added ${username} to allow list`);
    } catch (error) {
      // User already exists, skip
      console.log(`${username} already in allow list`);
    }
  }

  console.log("Seeding complete!");
}

seed().catch(console.error);
