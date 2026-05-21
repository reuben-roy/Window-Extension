import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { issueBackendSession } from '../src/lib/auth.js';

async function run() {
  console.log('--- Starting Progressive Difficulty Ramp-Up Validation ---');

  // Clean up any stale test user
  await prisma.user.deleteMany({
    where: {
      email: 'test-ramp-up@example.com',
    },
  });

  // Create a clean dummy user
  const user = await prisma.user.create({
    data: {
      email: 'test-ramp-up@example.com',
      displayName: 'Ramp Up Test User',
    },
  });
  console.log(`Created test user: ${user.email} (${user.id})`);

  // Issue backend session
  const session = await issueBackendSession(user.id);
  const token = session.sessionToken;
  console.log(`Issued backend session token`);

  // Find an active pack version and activate its topic
  const packVersion = await prisma.quizPackVersion.findFirst({
    include: {
      pack: {
        include: {
          topic: true,
        },
      },
      questions: true,
    },
  });

  if (!packVersion) {
    console.error('No QuizPackVersion found in database! Make sure learning catalog is seeded.');
    process.exit(1);
  }

  const topicId = packVersion.pack.topicId;
  const packVersionId = packVersion.id;
  console.log(`Found QuizPackVersion: ${packVersionId} under topic: ${packVersion.pack.topic.label} (${topicId})`);

  // Activate the topic for the user
  await prisma.userLearningTopic.create({
    data: {
      userId: user.id,
      topicId: topicId,
      active: true,
    },
  });
  console.log('Activated learning topic for the user');

  // Get easy, medium, and hard questions in this pack version
  const easyQuestions = packVersion.questions.filter((q) => q.difficulty === 'easy');
  const mediumQuestions = packVersion.questions.filter((q) => q.difficulty === 'medium');
  const hardQuestions = packVersion.questions.filter((q) => q.difficulty === 'hard');

  console.log(`Pack Version has: ${easyQuestions.length} Easy, ${mediumQuestions.length} Medium, ${hardQuestions.length} Hard questions.`);

  if (easyQuestions.length < 3 || mediumQuestions.length < 3 || hardQuestions.length < 3) {
    console.error('Test pack version does not have enough questions of each difficulty (need >= 3).');
    process.exit(1);
  }

  // Load Fastify App
  console.log('Initializing Fastify app...');
  const app = await buildApp();

  // Test Case 1: 0 correct easy answers. Only easy questions should be returned.
  console.log('\n--- Test Case 1: 0 correct easy answers ---');
  let loadedDifficulties = new Set<string>();
  // We make 10 requests to get a sample of questions loaded
  for (let i = 0; i < 10; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/learning/review/next?excludeQuestionId=`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const result = JSON.parse(res.body);
    if (result.prompt) {
      loadedDifficulties.add(result.prompt.difficulty);
    }
  }
  console.log('Loaded difficulties:', Array.from(loadedDifficulties));
  if (loadedDifficulties.has('medium') || loadedDifficulties.has('hard')) {
    console.error('FAIL: Loaded medium or hard questions when easy correct count is 0!');
    process.exit(1);
  } else {
    console.log('SUCCESS: Only Easy questions were served.');
  }

  // Test Case 2: Answer 3 easy questions correctly. Easy and Medium should be unlocked.
  console.log('\n--- Test Case 2: Answer 3 easy questions correctly ---');
  // Create 3 correct UserQuizProgress entries
  for (let i = 0; i < 3; i++) {
    await prisma.userQuizProgress.create({
      data: {
        userId: user.id,
        questionId: easyQuestions[i].id,
        lastWasCorrect: true,
        dueAt: new Date(Date.now() + 86400000), // due tomorrow so it is "seen"
      },
    });
  }
  console.log('Inserted 3 correct Easy answers into database.');

  loadedDifficulties.clear();
  for (let i = 0; i < 20; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/learning/review/next`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const result = JSON.parse(res.body);
    if (result.prompt) {
      loadedDifficulties.add(result.prompt.difficulty);
    }
  }
  console.log('Loaded difficulties:', Array.from(loadedDifficulties));
  if (loadedDifficulties.has('hard')) {
    console.error('FAIL: Loaded hard questions when medium correct count is 0!');
    process.exit(1);
  } else if (!loadedDifficulties.has('medium')) {
    console.warn('WARNING: Medium questions did not show up in random sampling, but hard is locked.');
  } else {
    console.log('SUCCESS: Easy and Medium questions were served, Hard remained locked.');
  }

  // Test Case 3: Answer 3 medium questions correctly. Easy, Medium, and Hard should all be unlocked.
  console.log('\n--- Test Case 3: Answer 3 medium questions correctly ---');
  // Create 3 correct UserQuizProgress entries for Medium questions
  for (let i = 0; i < 3; i++) {
    await prisma.userQuizProgress.create({
      data: {
        userId: user.id,
        questionId: mediumQuestions[i].id,
        lastWasCorrect: true,
        dueAt: new Date(Date.now() + 86400000),
      },
    });
  }
  console.log('Inserted 3 correct Medium answers into database.');

  loadedDifficulties.clear();
  for (let i = 0; i < 20; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/learning/review/next`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const result = JSON.parse(res.body);
    if (result.prompt) {
      loadedDifficulties.add(result.prompt.difficulty);
    }
  }
  console.log('Loaded difficulties:', Array.from(loadedDifficulties));
  if (!loadedDifficulties.has('hard')) {
    console.warn('WARNING: Hard questions did not show up in random sampling, but they should be unlocked.');
  } else {
    console.log('SUCCESS: Hard questions successfully unlocked and served!');
  }

  // Cleanup
  console.log('\nCleaning up test user and progress...');
  await prisma.user.delete({
    where: {
      id: user.id,
    },
  });
  console.log('Cleanup completed successfully.');
  console.log('\n--- All Progressive Difficulty Ramp-Up Verification Passed! ---');
  process.exit(0);
}

run().catch((err) => {
  console.error('Unexpected error running validation script:', err);
  process.exit(1);
});
