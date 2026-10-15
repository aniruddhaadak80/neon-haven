import { ACHIEVEMENTS, type AchievementId } from '../config'

/**
 * One-shot achievement unlocks. Pure logic — persistence is the caller's job
 * (pass the saved id list into the constructor, read `ids` back on save).
 */
export class Achievements {
  private owned = new Set<string>()

  constructor(unlocked?: readonly string[] | null) {
    if (!unlocked) return
    for (const id of unlocked) {
      if (id in ACHIEVEMENTS) this.owned.add(id)
    }
  }

  has(id: AchievementId): boolean {
    return this.owned.has(id)
  }

  /** Unlock an achievement. Returns true only the first time. */
  unlock(id: AchievementId): boolean {
    if (this.owned.has(id)) return false
    this.owned.add(id)
    return true
  }

  get count(): number {
    return this.owned.size
  }

  static get total(): number {
    return Object.keys(ACHIEVEMENTS).length
  }

  /** Sorted id list for saving. */
  get ids(): string[] {
    return [...this.owned].sort()
  }
}
