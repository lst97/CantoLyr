# NOTE

## Tone Map

Prompt: two peron just meet together during some event and they can wait to see them next time.

2253394259

334334

02300394239

22533244940223

## Step 1 split

22 5 33 9 4 25 9

22 5 3 39 42 59

2 25 33 9 42 59

==

3 34 3 34

33 4 33 4

3 34 33 4

==

02 30 03 94 2 39

0 23 0 03 9 42 39

02 3 0 03 94 23 9

==

22 5 33 2 44 94 02 23

2 2 53 32 4 4 94 02 2 3

22 53 3 24 4 94 0 22 3

## Step 1.1 Set

- Group 1 unique numbers: {33, 2, 3, 4, 5, 39, 9, 42, 22, 25, 59} - (meet a friend)
- Group 2 unique numbers: {33, 34, 3, 4} - (playing game)
- Group 3 unique numbers: {0, 2, 3, 39, 9, 42, 23, 30, 94} - (Sun set)
- Group 4 unique numbers: {32, 33, 2, 3, 4, 5, 0, 44, 53, 22, 23, 24, 94} - (Go home and separate and hope to see again next time)

---

## Step 2 - Retriever - order by 1, 3, 2, 4

query pgdb frequencies word top 100 (match tone)

group x:
iteration group x (33, 2, 3, 4, 5, 39, 9, 42, 22, 25, 59)

Requirement: generated sentence candidate if any + [scene (make a set for the tone base on scene - 200) + 50(random weight by freq and tone - no scene)]

## Step 3 - Query llm : (22 5 33 9 4 25 9)x5, (22 5 3 39 42 59)x5, (2 25 33 9 42 59)x5

- llm -> base on the candidate and tone to form a sentence that match the theme "meet a friend"
- re-rank -> output top 1 for each line

## Step 4 - Output lyric

lyrists adjust the final result
