import assert from 'node:assert/strict';
import { parseSentenceToChoices } from './parser.js';

const cases = [
  [
    'Should I eat ramen, tacos, or sushi tonight?',
    ['Ramen', 'Tacos', 'Sushi'],
  ],
  [
    'Should I go to the gym or stay home and read?',
    ['Go to the gym', 'Stay home and read'],
  ],
  [
    'Help me pick between coffee, tea, and matcha',
    ['Coffee', 'Tea', 'Matcha'],
  ],
  [
    'Tacos vs burgers vs pizza',
    ['Tacos', 'Burgers', 'Pizza'],
  ],
  [
    "I can't decide whether to watch Dune or play Hades.",
    ['Watch Dune', 'Play Hades'],
  ],
  [
    'Coffee or tea?',
    ['Coffee', 'Tea'],
  ],
  [
    'Either red shirt or blue shirt',
    ['Red shirt', 'Blue shirt'],
  ],
  [
    '1. Walk in the park\n2. Read a book\n3. Take a nap',
    ['Walk in the park', 'Read a book', 'Take a nap'],
  ],
  [
    'Pasta / Salad / Soup',
    ['Pasta', 'Salad', 'Soup'],
  ],
  [
    'Should I get Thai food, Indian food, or pizza for dinner?',
    ['Thai food', 'Indian food', 'Pizza'],
  ],
  [
    'Coffee, coffee, or tea',
    ['Coffee', 'Tea'],
  ],
  [
    '   ',
    [],
  ],
];

let passed = 0;
for (const [input, expected] of cases) {
  const actual = parseSentenceToChoices(input);
  assert.deepEqual(actual, expected, `Failed for: "${input}"\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`);
  passed += 1;
}

console.log(`All ${passed}/${cases.length} parser test cases passed!`);
