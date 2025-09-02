/**
 * Common types used across the domain
 */

export type EntryType = 'vocab' | 'char';

export type PartOfSpeech = 
  | 'NOUN' 
  | 'ADJ' 
  | 'NUM' 
  | 'LETTER' 
  | 'VERB'
  | 'ADV'
  | 'PREP'
  | 'CONJ'
  | 'INTJ'
  | 'PRON'
  | 'DET'
  | 'PART'
  | 'UNKNOWN';

export type Register = 'formal' | 'neutral' | 'colloquial';