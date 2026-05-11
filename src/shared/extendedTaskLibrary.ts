import type {
  ExtendedTaskLibraryEntry,
  ExtendedTaskLibraryEntrySource,
  ExtendedTaskSet,
  ExtendedTaskSetItem,
  ExtendedTaskTemplate,
} from './types';

type ExtendedTaskSeedItem = readonly [label: string, url: string];

interface ExtendedTaskSeedGroup {
  id: string;
  title: string;
  items: readonly ExtendedTaskSeedItem[];
}

export interface ExtendedTaskLibraryDragPayload {
  entryId: string;
  source: ExtendedTaskLibraryEntrySource;
}

export const EXTENDED_TASK_LIBRARY_DRAG_MIME = 'application/x-window-extended-task-library-entry';
export const BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID = 'leetcode-150-master';

const LEETCODE_ROADMAP_GROUPS: readonly ExtendedTaskSeedGroup[] = [
  {
    id: 'leetcode-arrays-hashing',
    title: 'Arrays & Hashing',
    items: [
      ['Contains Duplicate', 'https://leetcode.com/problems/contains-duplicate/'],
      ['Valid Anagram', 'https://leetcode.com/problems/valid-anagram/'],
      ['Two Sum', 'https://leetcode.com/problems/two-sum/'],
      ['Group Anagrams', 'https://leetcode.com/problems/group-anagrams/'],
      ['Top K Frequent Elements', 'https://leetcode.com/problems/top-k-frequent-elements/'],
      ['Encode and Decode Strings', 'https://leetcode.com/problems/encode-and-decode-strings/'],
      ['Product of Array Except Self', 'https://leetcode.com/problems/product-of-array-except-self/'],
      ['Valid Sudoku', 'https://leetcode.com/problems/valid-sudoku/'],
      ['Longest Consecutive Sequence', 'https://leetcode.com/problems/longest-consecutive-sequence/'],
    ],
  },
  {
    id: 'leetcode-two-pointers',
    title: 'Two Pointers',
    items: [
      ['Valid Palindrome', 'https://leetcode.com/problems/valid-palindrome/'],
      ['Two Sum II - Input Array Is Sorted', 'https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/'],
      ['3Sum', 'https://leetcode.com/problems/3sum/'],
      ['Container With Most Water', 'https://leetcode.com/problems/container-with-most-water/'],
      ['Trapping Rain Water', 'https://leetcode.com/problems/trapping-rain-water/'],
    ],
  },
  {
    id: 'leetcode-sliding-window',
    title: 'Sliding Window',
    items: [
      ['Best Time to Buy and Sell Stock', 'https://leetcode.com/problems/best-time-to-buy-and-sell-stock/'],
      ['Longest Substring Without Repeating Characters', 'https://leetcode.com/problems/longest-substring-without-repeating-characters/'],
      ['Longest Repeating Character Replacement', 'https://leetcode.com/problems/longest-repeating-character-replacement/'],
      ['Permutation in String', 'https://leetcode.com/problems/permutation-in-string/'],
      ['Minimum Window Substring', 'https://leetcode.com/problems/minimum-window-substring/'],
      ['Sliding Window Maximum', 'https://leetcode.com/problems/sliding-window-maximum/'],
    ],
  },
  {
    id: 'leetcode-stack',
    title: 'Stack',
    items: [
      ['Valid Parentheses', 'https://leetcode.com/problems/valid-parentheses/'],
      ['Min Stack', 'https://leetcode.com/problems/min-stack/'],
      ['Evaluate Reverse Polish Notation', 'https://leetcode.com/problems/evaluate-reverse-polish-notation/'],
      ['Generate Parentheses', 'https://leetcode.com/problems/generate-parentheses/'],
      ['Daily Temperatures', 'https://leetcode.com/problems/daily-temperatures/'],
      ['Car Fleet', 'https://leetcode.com/problems/car-fleet/'],
      ['Largest Rectangle in Histogram', 'https://leetcode.com/problems/largest-rectangle-in-histogram/'],
    ],
  },
  {
    id: 'leetcode-binary-search',
    title: 'Binary Search',
    items: [
      ['Binary Search', 'https://leetcode.com/problems/binary-search/'],
      ['Search a 2D Matrix', 'https://leetcode.com/problems/search-a-2d-matrix/'],
      ['Koko Eating Bananas', 'https://leetcode.com/problems/koko-eating-bananas/'],
      ['Find Minimum in Rotated Sorted Array', 'https://leetcode.com/problems/find-minimum-in-rotated-sorted-array/'],
      ['Search in Rotated Sorted Array', 'https://leetcode.com/problems/search-in-rotated-sorted-array/'],
      ['Time Based Key-Value Store', 'https://leetcode.com/problems/time-based-key-value-store/'],
      ['Median of Two Sorted Arrays', 'https://leetcode.com/problems/median-of-two-sorted-arrays/'],
    ],
  },
  {
    id: 'leetcode-linked-list',
    title: 'Linked List',
    items: [
      ['Reverse Linked List', 'https://leetcode.com/problems/reverse-linked-list/'],
      ['Merge Two Sorted Lists', 'https://leetcode.com/problems/merge-two-sorted-lists/'],
      ['Reorder List', 'https://leetcode.com/problems/reorder-list/'],
      ['Remove Nth Node From End of List', 'https://leetcode.com/problems/remove-nth-node-from-end-of-list/'],
      ['Copy List With Random Pointer', 'https://leetcode.com/problems/copy-list-with-random-pointer/'],
      ['Add Two Numbers', 'https://leetcode.com/problems/add-two-numbers/'],
      ['Linked List Cycle', 'https://leetcode.com/problems/linked-list-cycle/'],
      ['Find the Duplicate Number', 'https://leetcode.com/problems/find-the-duplicate-number/'],
      ['LRU Cache', 'https://leetcode.com/problems/lru-cache/'],
      ['Merge k Sorted Lists', 'https://leetcode.com/problems/merge-k-sorted-lists/'],
      ['Reverse Nodes in k-Group', 'https://leetcode.com/problems/reverse-nodes-in-k-group/'],
    ],
  },
  {
    id: 'leetcode-trees',
    title: 'Trees',
    items: [
      ['Invert Binary Tree', 'https://leetcode.com/problems/invert-binary-tree/'],
      ['Maximum Depth of Binary Tree', 'https://leetcode.com/problems/maximum-depth-of-binary-tree/'],
      ['Diameter of Binary Tree', 'https://leetcode.com/problems/diameter-of-binary-tree/'],
      ['Balanced Binary Tree', 'https://leetcode.com/problems/balanced-binary-tree/'],
      ['Same Tree', 'https://leetcode.com/problems/same-tree/'],
      ['Subtree of Another Tree', 'https://leetcode.com/problems/subtree-of-another-tree/'],
      ['Lowest Common Ancestor of a Binary Search Tree', 'https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/'],
      ['Binary Tree Level Order Traversal', 'https://leetcode.com/problems/binary-tree-level-order-traversal/'],
      ['Binary Tree Right Side View', 'https://leetcode.com/problems/binary-tree-right-side-view/'],
      ['Count Good Nodes in Binary Tree', 'https://leetcode.com/problems/count-good-nodes-in-binary-tree/'],
      ['Validate Binary Search Tree', 'https://leetcode.com/problems/validate-binary-search-tree/'],
      ['Kth Smallest Element in a BST', 'https://leetcode.com/problems/kth-smallest-element-in-a-bst/'],
      ['Construct Binary Tree from Preorder and Inorder Traversal', 'https://leetcode.com/problems/construct-binary-tree-from-preorder-and-inorder-traversal/'],
      ['Binary Tree Maximum Path Sum', 'https://leetcode.com/problems/binary-tree-maximum-path-sum/'],
      ['Serialize and Deserialize Binary Tree', 'https://leetcode.com/problems/serialize-and-deserialize-binary-tree/'],
    ],
  },
  {
    id: 'leetcode-tries',
    title: 'Tries',
    items: [
      ['Implement Trie (Prefix Tree)', 'https://leetcode.com/problems/implement-trie-prefix-tree/'],
      ['Design Add and Search Words Data Structure', 'https://leetcode.com/problems/design-add-and-search-words-data-structure/'],
      ['Word Search II', 'https://leetcode.com/problems/word-search-ii/'],
    ],
  },
  {
    id: 'leetcode-heap-priority-queue',
    title: 'Heap / Priority Queue',
    items: [
      ['Kth Largest Element in a Stream', 'https://leetcode.com/problems/kth-largest-element-in-a-stream/'],
      ['Last Stone Weight', 'https://leetcode.com/problems/last-stone-weight/'],
      ['K Closest Points to Origin', 'https://leetcode.com/problems/k-closest-points-to-origin/'],
      ['Kth Largest Element in an Array', 'https://leetcode.com/problems/kth-largest-element-in-an-array/'],
      ['Task Scheduler', 'https://leetcode.com/problems/task-scheduler/'],
      ['Design Twitter', 'https://leetcode.com/problems/design-twitter/'],
      ['Find Median from Data Stream', 'https://leetcode.com/problems/find-median-from-data-stream/'],
    ],
  },
  {
    id: 'leetcode-backtracking',
    title: 'Backtracking',
    items: [
      ['Subsets', 'https://leetcode.com/problems/subsets/'],
      ['Combination Sum', 'https://leetcode.com/problems/combination-sum/'],
      ['Permutations', 'https://leetcode.com/problems/permutations/'],
      ['Subsets II', 'https://leetcode.com/problems/subsets-ii/'],
      ['Combination Sum II', 'https://leetcode.com/problems/combination-sum-ii/'],
      ['Word Search', 'https://leetcode.com/problems/word-search/'],
      ['Palindrome Partitioning', 'https://leetcode.com/problems/palindrome-partitioning/'],
      ['Letter Combinations of a Phone Number', 'https://leetcode.com/problems/letter-combinations-of-a-phone-number/'],
      ['N-Queens', 'https://leetcode.com/problems/n-queens/'],
    ],
  },
  {
    id: 'leetcode-graphs',
    title: 'Graphs',
    items: [
      ['Number of Islands', 'https://leetcode.com/problems/number-of-islands/'],
      ['Clone Graph', 'https://leetcode.com/problems/clone-graph/'],
      ['Max Area of Island', 'https://leetcode.com/problems/max-area-of-island/'],
      ['Pacific Atlantic Water Flow', 'https://leetcode.com/problems/pacific-atlantic-water-flow/'],
      ['Surrounded Regions', 'https://leetcode.com/problems/surrounded-regions/'],
      ['Rotting Oranges', 'https://leetcode.com/problems/rotting-oranges/'],
      ['Walls and Gates', 'https://leetcode.com/problems/walls-and-gates/'],
      ['Course Schedule', 'https://leetcode.com/problems/course-schedule/'],
      ['Course Schedule II', 'https://leetcode.com/problems/course-schedule-ii/'],
      ['Redundant Connection', 'https://leetcode.com/problems/redundant-connection/'],
      ['Number of Connected Components in an Undirected Graph', 'https://leetcode.com/problems/number-of-connected-components-in-an-undirected-graph/'],
      ['Graph Valid Tree', 'https://leetcode.com/problems/graph-valid-tree/'],
      ['Word Ladder', 'https://leetcode.com/problems/word-ladder/'],
    ],
  },
  {
    id: 'leetcode-advanced-graphs',
    title: 'Advanced Graphs',
    items: [
      ['Reconstruct Itinerary', 'https://leetcode.com/problems/reconstruct-itinerary/'],
      ['Min Cost to Connect All Points', 'https://leetcode.com/problems/min-cost-to-connect-all-points/'],
      ['Network Delay Time', 'https://leetcode.com/problems/network-delay-time/'],
      ['Swim in Rising Water', 'https://leetcode.com/problems/swim-in-rising-water/'],
      ['Alien Dictionary', 'https://leetcode.com/problems/alien-dictionary/'],
      ['Cheapest Flights Within K Stops', 'https://leetcode.com/problems/cheapest-flights-within-k-stops/'],
    ],
  },
  {
    id: 'leetcode-1d-dp',
    title: '1-D Dynamic Programming',
    items: [
      ['Climbing Stairs', 'https://leetcode.com/problems/climbing-stairs/'],
      ['Min Cost Climbing Stairs', 'https://leetcode.com/problems/min-cost-climbing-stairs/'],
      ['House Robber', 'https://leetcode.com/problems/house-robber/'],
      ['House Robber II', 'https://leetcode.com/problems/house-robber-ii/'],
      ['Longest Palindromic Substring', 'https://leetcode.com/problems/longest-palindromic-substring/'],
      ['Palindromic Substrings', 'https://leetcode.com/problems/palindromic-substrings/'],
      ['Decode Ways', 'https://leetcode.com/problems/decode-ways/'],
      ['Coin Change', 'https://leetcode.com/problems/coin-change/'],
      ['Maximum Product Subarray', 'https://leetcode.com/problems/maximum-product-subarray/'],
      ['Word Break', 'https://leetcode.com/problems/word-break/'],
      ['Longest Increasing Subsequence', 'https://leetcode.com/problems/longest-increasing-subsequence/'],
      ['Partition Equal Subset Sum', 'https://leetcode.com/problems/partition-equal-subset-sum/'],
    ],
  },
  {
    id: 'leetcode-2d-dp',
    title: '2-D Dynamic Programming',
    items: [
      ['Unique Paths', 'https://leetcode.com/problems/unique-paths/'],
      ['Longest Common Subsequence', 'https://leetcode.com/problems/longest-common-subsequence/'],
      ['Best Time to Buy and Sell Stock with Cooldown', 'https://leetcode.com/problems/best-time-to-buy-and-sell-stock-with-cooldown/'],
      ['Coin Change II', 'https://leetcode.com/problems/coin-change-ii/'],
      ['Target Sum', 'https://leetcode.com/problems/target-sum/'],
      ['Interleaving String', 'https://leetcode.com/problems/interleaving-string/'],
      ['Longest Increasing Path in a Matrix', 'https://leetcode.com/problems/longest-increasing-path-in-a-matrix/'],
      ['Distinct Subsequences', 'https://leetcode.com/problems/distinct-subsequences/'],
      ['Edit Distance', 'https://leetcode.com/problems/edit-distance/'],
      ['Burst Balloons', 'https://leetcode.com/problems/burst-balloons/'],
      ['Regular Expression Matching', 'https://leetcode.com/problems/regular-expression-matching/'],
    ],
  },
  {
    id: 'leetcode-greedy',
    title: 'Greedy',
    items: [
      ['Maximum Subarray', 'https://leetcode.com/problems/maximum-subarray/'],
      ['Jump Game', 'https://leetcode.com/problems/jump-game/'],
      ['Jump Game II', 'https://leetcode.com/problems/jump-game-ii/'],
      ['Gas Station', 'https://leetcode.com/problems/gas-station/'],
      ['Hand of Straights', 'https://leetcode.com/problems/hand-of-straights/'],
      ['Merge Triplets to Form Target Triplet', 'https://leetcode.com/problems/merge-triplets-to-form-target-triplet/'],
      ['Partition Labels', 'https://leetcode.com/problems/partition-labels/'],
      ['Valid Parenthesis String', 'https://leetcode.com/problems/valid-parenthesis-string/'],
    ],
  },
  {
    id: 'leetcode-intervals',
    title: 'Intervals',
    items: [
      ['Insert Interval', 'https://leetcode.com/problems/insert-interval/'],
      ['Merge Intervals', 'https://leetcode.com/problems/merge-intervals/'],
      ['Non-overlapping Intervals', 'https://leetcode.com/problems/non-overlapping-intervals/'],
      ['Meeting Rooms', 'https://leetcode.com/problems/meeting-rooms/'],
      ['Meeting Rooms II', 'https://leetcode.com/problems/meeting-rooms-ii/'],
      ['Minimum Interval to Include Each Query', 'https://leetcode.com/problems/minimum-interval-to-include-each-query/'],
    ],
  },
  {
    id: 'leetcode-math-geometry',
    title: 'Math & Geometry',
    items: [
      ['Rotate Image', 'https://leetcode.com/problems/rotate-image/'],
      ['Spiral Matrix', 'https://leetcode.com/problems/spiral-matrix/'],
      ['Set Matrix Zeroes', 'https://leetcode.com/problems/set-matrix-zeroes/'],
      ['Happy Number', 'https://leetcode.com/problems/happy-number/'],
      ['Plus One', 'https://leetcode.com/problems/plus-one/'],
      ['Pow(x, n)', 'https://leetcode.com/problems/powx-n/'],
      ['Multiply Strings', 'https://leetcode.com/problems/multiply-strings/'],
      ['Detect Squares', 'https://leetcode.com/problems/detect-squares/'],
    ],
  },
  {
    id: 'leetcode-bit-manipulation',
    title: 'Bit Manipulation',
    items: [
      ['Single Number', 'https://leetcode.com/problems/single-number/'],
      ['Number of 1 Bits', 'https://leetcode.com/problems/number-of-1-bits/'],
      ['Counting Bits', 'https://leetcode.com/problems/counting-bits/'],
      ['Reverse Bits', 'https://leetcode.com/problems/reverse-bits/'],
      ['Missing Number', 'https://leetcode.com/problems/missing-number/'],
      ['Sum of Two Integers', 'https://leetcode.com/problems/sum-of-two-integers/'],
      ['Reverse Integer', 'https://leetcode.com/problems/reverse-integer/'],
    ],
  },
] as const;

function createStableItems(templateId: string, items: readonly ExtendedTaskSeedItem[]): ExtendedTaskSetItem[] {
  return items.map(([label, url], index) => ({
    id: `${templateId}-item-${index + 1}`,
    label,
    url,
  }));
}

function createTemplate(seedGroup: ExtendedTaskSeedGroup): ExtendedTaskTemplate {
  return {
    id: seedGroup.id,
    title: seedGroup.title,
    items: createStableItems(seedGroup.id, seedGroup.items),
    source: 'built-in',
  };
}

export const BUILT_IN_LEETCODE_TOPIC_TEMPLATES: ExtendedTaskTemplate[] =
  LEETCODE_ROADMAP_GROUPS.map(createTemplate);

export const BUILT_IN_LEETCODE_MASTER_TEMPLATE: ExtendedTaskTemplate = {
  id: BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
  title: 'LeetCode 150',
  items: createStableItems(
    BUILT_IN_LEETCODE_MASTER_TEMPLATE_ID,
    LEETCODE_ROADMAP_GROUPS.flatMap((group) =>
      group.items.map(
        ([label, url]) => [`${group.title} · ${label}`, url] as const,
      ),
    ),
  ),
  source: 'built-in',
};

export const BUILT_IN_EXTENDED_TASK_TEMPLATES: ExtendedTaskTemplate[] = [
  BUILT_IN_LEETCODE_MASTER_TEMPLATE,
  ...BUILT_IN_LEETCODE_TOPIC_TEMPLATES,
];

export const BUILT_IN_LEETCODE_TOPIC_TEMPLATE_IDS = BUILT_IN_LEETCODE_TOPIC_TEMPLATES.map(
  (template) => template.id,
);

export function toExtendedTaskLibraryEntry(
  entry: ExtendedTaskTemplate | ExtendedTaskSet,
): ExtendedTaskLibraryEntry {
  return {
    id: entry.id,
    title: entry.title,
    items: entry.items.map((item) => ({ ...item })),
    source: 'source' in entry ? entry.source : 'user',
  };
}

function safeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `extended-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function duplicateExtendedTaskTemplate(
  template: ExtendedTaskTemplate,
  now: string = new Date().toISOString(),
): ExtendedTaskSet {
  return {
    id: safeId(),
    title: `${template.title} Copy`,
    items: template.items.map((item) => ({
      id: safeId(),
      label: item.label,
      url: item.url,
    })),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

export function encodeExtendedTaskLibraryEntryDragPayload(
  entry: Pick<ExtendedTaskLibraryEntry, 'id' | 'source'>,
): string {
  return JSON.stringify({
    entryId: entry.id,
    source: entry.source,
  } satisfies ExtendedTaskLibraryDragPayload);
}

export function decodeExtendedTaskLibraryEntryDragPayload(
  raw: string | null | undefined,
): ExtendedTaskLibraryDragPayload | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ExtendedTaskLibraryDragPayload>;
    if (
      typeof parsed.entryId !== 'string' ||
      (parsed.source !== 'built-in' && parsed.source !== 'user')
    ) {
      return null;
    }

    return {
      entryId: parsed.entryId,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

export function findExtendedTaskLibraryEntryById(
  entryId: string,
  source: ExtendedTaskLibraryEntrySource,
  builtInTemplates: readonly ExtendedTaskTemplate[],
  taskSets: readonly ExtendedTaskSet[],
): ExtendedTaskLibraryEntry | null {
  if (!entryId) return null;

  if (source === 'built-in') {
    const template = builtInTemplates.find((candidate) => candidate.id === entryId);
    return template ? toExtendedTaskLibraryEntry(template) : null;
  }

  const taskSet = taskSets.find((candidate) => candidate.id === entryId);
  return taskSet ? toExtendedTaskLibraryEntry(taskSet) : null;
}

export function resolveDraggedExtendedTaskLibraryEntry(options: {
  draggingEntry?: ExtendedTaskLibraryEntry | null;
  plainTextPayload?: string | null;
  customPayload?: string | null;
  builtInTemplates: readonly ExtendedTaskTemplate[];
  taskSets: readonly ExtendedTaskSet[];
}): ExtendedTaskLibraryEntry | null {
  if (options.draggingEntry) {
    return options.draggingEntry;
  }

  const payload =
    decodeExtendedTaskLibraryEntryDragPayload(options.plainTextPayload) ??
    decodeExtendedTaskLibraryEntryDragPayload(options.customPayload);

  if (!payload) return null;

  return findExtendedTaskLibraryEntryById(
    payload.entryId,
    payload.source,
    options.builtInTemplates,
    options.taskSets,
  );
}
