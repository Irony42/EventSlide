import type { JoinCode } from '../../domain/shared/joinCode'
import { FakeEventRepository } from './fakeEventRepository'

/**
 * A box whose join-code space answers "taken" to everything: what the attempt bound of
 * `createEvent` and `rotateJoinCode` is for. It counts the candidates it was asked about, so the
 * bound is a number a test can read and not a feeling.
 */
export class SaturatedJoinCodeEventRepository extends FakeEventRepository {
  asked = 0

  override async joinCodeTaken(_code: JoinCode): Promise<boolean> {
    this.asked += 1
    return true
  }
}
