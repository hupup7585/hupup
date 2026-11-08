import { config } from "@/lib/config";
import { getTwilio } from "@/lib/twilio-client";

/**
 * Call recording (Abraham O). Starts only after the caller has heard the recording notice. Card numbers and CVVs are
 * never collected on calls (payment happens on Sola's secure page from a texted link); if card entry is ever added to
 * a call, call pauseRecording() before it and resumeRecording() after it.
 */
export async function startRecording(callSid: string): Promise<boolean> {
  const tw = getTwilio();
  if (!tw) return false;
  try {
    await tw.calls(callSid).recordings.create({
      recordingStatusCallback: `${config.baseUrl()}/api/voice/call-recording`,
      recordingStatusCallbackMethod: "POST",
      recordingChannels: "dual",
    });
    return true;
  } catch (e) {
    console.error("[recording] could not start", e);
    return false;
  }
}

export async function pauseRecording(callSid: string) {
  const tw = getTwilio();
  if (!tw) return;
  await tw.calls(callSid).recordings("Twilio.CURRENT").update({ status: "paused", pauseBehavior: "skip" });
}

export async function resumeRecording(callSid: string) {
  const tw = getTwilio();
  if (!tw) return;
  await tw.calls(callSid).recordings("Twilio.CURRENT").update({ status: "in-progress" });
}
