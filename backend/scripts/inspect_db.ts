import { prisma } from '../src/lib/prisma.js';

async function run() {
  console.log('--- Database Inspection ---');

  // 1. Check all users
  const users = await prisma.user.findMany();
  console.log(`Total users in DB: ${users.length}`);
  for (const u of users) {
    console.log(`- User: ${u.email} (ID: ${u.id})`);
    
    // Check their active topics
    const activeTopics = await prisma.userLearningTopic.findMany({
      where: { userId: u.id, active: true },
      include: { topic: true }
    });
    console.log(`  Active topics (${activeTopics.length}):`);
    for (const at of activeTopics) {
      console.log(`    * Topic: ${at.topic.label} (ID: ${at.topic.id})`);
      
      // Check packs under this topic
      const packs = await prisma.quizPack.findMany({
        where: { topicId: at.topic.id },
        include: { versions: { include: { questions: true } } }
      });
      console.log(`      Packs (${packs.length}):`);
      for (const p of packs) {
        console.log(`        - Pack: ${p.title} (Status: ${p.status}, Canonical: ${p.canonical})`);
        for (const v of p.versions) {
          const easy = v.questions.filter(q => q.difficulty === 'easy').length;
          const medium = v.questions.filter(q => q.difficulty === 'medium').length;
          const hard = v.questions.filter(q => q.difficulty === 'hard').length;
          console.log(`          * Version ${v.versionNumber} (ID: ${v.id}) Questions: ${v.questions.length} (Easy: ${easy}, Medium: ${medium}, Hard: ${hard})`);
        }
      }
    }

    // Check their progress
    const progressCount = await prisma.userQuizProgress.count({
      where: { userId: u.id }
    });
    const correctCount = await prisma.userQuizProgress.count({
      where: { userId: u.id, lastWasCorrect: true }
    });
    console.log(`  Quiz Progress count: ${progressCount} (Correct: ${correctCount})`);
  }
}

run().catch(err => {
  console.error(err);
});
