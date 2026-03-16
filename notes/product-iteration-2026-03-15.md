# Product Iteration Notes - 2026-03-15

## Research brief: Typeless-like user value signals

Top recurring value signals across competitor docs and user feedback:
- Lowest possible latency from speech stop to pasted text.
- Reliable insertion into active app with minimal friction.
- Choice between "cleaned" output and raw transcript speed.
- Transparent privacy/cost controls (local/offline vs cloud).

## References

1. Superwhisper product page (competitor positioning)
- https://superwhisper.com/
- Signals: speed/reliability and app-agnostic dictation are core value propositions.

2. Superwhisper docs: Realtime mode
- https://superwhisper.com/docs/windows/realtime
- Signals: users are offered explicit low-latency tradeoffs and formatting controls.

3. Wispr Flow features page
- https://wisprflow.ai/features
- Signals: selling points emphasize speed, context, and "everywhere" typing workflow.

4. Wispr Flow App Store reviews (public user feedback)
- https://apps.apple.com/us/app/wispr-flow-voice-dictation/id6746647241
- Signals: users praise speed/quality; complaints cluster around occasional insertion/accuracy misses.

5. Product Hunt reviews for Wispr Flow
- https://www.producthunt.com/products/wispr-flow/reviews
- Signals: positive reaction to productivity boost; repeated asks for reliability and smoother editing loops.

6. Reddit discussion on voice dictation app reliability/friction
- https://www.reddit.com/r/macapps/comments/1j8jj73/superwhisper_for_free/
- Signals: users compare products mainly on practical reliability, speed, and whether cleanup steps add friction.

## Decision from research

Chosen increment: add a user-facing toggle to skip the LLM formatter pass and paste raw transcription directly.

Reason:
- Highest ROI in smallest scope.
- Reduces request count per dictation from 2 API calls (transcribe + format) to 1 when disabled.
- Improves perceived responsiveness and reduces failure surface/cost for users who prioritize raw speed.
