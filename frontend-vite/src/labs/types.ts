// frontend-vite/src/labs/types.ts
//
// Static registry schema for 数创实验室 lab listings.
// Mirrors frontend-vite/src/labs/registry.json at build time.

export type LabStatus = 'active' | 'coming-soon'

export interface LabIframeSrc {
  /** dev iframe src (e.g. http://localhost:5577/?embed=1) */
  dev: string
  /** prod iframe src (e.g. /labs/minicast/?embed=1) */
  prod: string
}

export interface LabEntry {
  id: string
  title: string
  subtitle: string
  description: string
  icon: string
  iframeSrc: LabIframeSrc
  status: LabStatus
  tags: string[]
}

export interface LabRegistry {
  labs: LabEntry[]
}