import { db } from "./index";
import { allowList, user, userSettings } from "./schema";
import { eq } from "drizzle-orm";

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

  // Create settings records for existing users who don't have them
  console.log("Creating settings for existing users...");
  const existingUsers = await db.select().from(user);

  for (const existingUser of existingUsers) {
    const existingSettings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, existingUser.id))
      .limit(1);

    if (existingSettings.length === 0) {
      await db.insert(userSettings).values({
        userId: existingUser.id,
        vaultName: null,
        incomingFolder: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`Created settings for user ${existingUser.email}`);
    }
  }

  console.log("Seeding complete!");
}

seed().catch(console.error);
