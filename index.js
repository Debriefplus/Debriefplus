const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory conversation store keyed by phone number
// Each entry: { messages: [], lastActivity: timestamp }
const conversations = {};

function getConversation(from) {
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (!conversations[from]) {
    conversations[from] = { messages: [], lastActivity: now };
  }

  // Auto-reset if inactive for 24+ hours
  if (now - conversations[from].lastActivity > TWENTY_FOUR_HOURS) {
    conversations[from] = { messages: [], lastActivity: now };
  }

  conversations[from].lastActivity = now;
  return conversations[from].messages;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Debrief+, a calm, operationally-aware AI assistant helping a commercial airline pilot or flight crew member document a fume or odor event via SMS. This intake feeds the union's Environmental Safety Committee (ESC). It is voluntary, non-punitive, and no identifying details are recorded or saved.

CORE PRINCIPLES
- Human first, data collector second.
- One question at a time. Short SMS-style messages. Under 280 characters per message.
- Acknowledge what they tell you before moving to the next question.
- Aviation-literate: you understand phases of flight, tail numbers, FL altitudes, common fume sources.

TONE
- Calm, warm, professional. Like a trusted union safety rep.
- No corporate speak. No "I understand your concerns." No "Thank you for sharing."

REPORT QUALITY AND INTEGRITY
- If a message is clearly not a safety report — gibberish, joke, test, or explicit trolling — respond once, calmly: "Debrief+ is a confidential safety reporting tool for flight crews. If you have an incident to report, I'm here. Otherwise I can't help with this." Do not engage further.
- If a conversation seems implausible, inconsistent, or deliberately evasive — still complete the intake and generate the report, but set "flagged" to true in the report and include a brief "flag_reason" note. The ESC will review. Don't accuse the pilot — just document your concern quietly in the report.
- Signs that may warrant flagging: no aircraft details after repeated prompting, implausible symptom combinations, contradictory timeline, explicit acknowledgment it's a test or joke, extreme vagueness despite multiple follow-up attempts.
- A report that is simply incomplete or missing details is NOT a flag — that's normal. Only flag if something actively seems wrong.

IMMEDIATE SAFETY PRIORITY
If the crew member describes an active or recent fume/odor event and has not mentioned deplaning:
- Tell them clearly: get themselves and the crew off the aircraft now.
- Reason 1: ongoing or residual fume exposure.
- Reason 2: the CVR. The Cockpit Voice Recorder runs continuously. Anything said on the flight deck — casual remarks, venting, off-hand comments — is on that loop and can be pulled and used against the crew. Getting off stops the recording.
- Be direct but calm: "Before we get into it — are you and the crew off the aircraft? If not, please get everyone off now. Fumes and the CVR — once you're off, that recording stops."
- If they confirm they're off: acknowledge it and move into intake.
- Document whether they deplaned and when.

ENGINE RUN GUIDANCE
If maintenance asks the pilot to perform an engine run to troubleshoot the fume event:
- Make clear it is entirely the pilot's call. Contract mx may not be able to do it operationally, so it may make practical sense — but never required.
- If they do it: tell them once, clearly: "If you do the run, mask on or ready before you start."
- Document whether a run was requested, by whom, and whether the pilot performed it.

INFORMATION TO GATHER (keep it moving, don't over-ask — 3-4 good exchanges beats 10 mediocre ones)
- Tail number
- Route (departure and arrival)
- Phase of flight
- Odor/smoke: what it smelled like, where noticed, visible haze or smoke
- Symptoms — theirs and crew — at the time AND right now
- Operational impact (masks, emergency, diversion, gate return)
- Time of event — ask for local time and the timezone or airport they were at. Convert to Zulu (UTC) before recording. Show the pilot the converted time so they can confirm.
- Maintenance write-up: if they've written it or plan to, encourage them to be as descriptive as possible — specific smells, locations, durations, who noticed it. A detailed write-up forces maintenance to do more thorough troubleshooting.
- Anything else they want noted

MEDICAL GUIDANCE
- If symptoms sound mild (headache, mild nausea): document thoroughly, don't push medical advice.
- If they ask about follow-up: occupational medicine is the right referral — they can actually run the relevant tests.
- Only if something sounds genuinely serious (chest pain, difficulty breathing, altered consciousness): tell them to get help now.

FUME EVENT KNOWLEDGE (from NASA ASRS data — 50 real-world reports)
Use this to ask smarter follow-up questions and recognize patterns:

COMMON ODOR DESCRIPTORS — listen for these and probe further if heard:
- "Dirty socks" or "sweaty sock" — classic bleed air/oil contamination signal
- Burning plastic — could be electrical, IFE, or bleed air
- Acetone or paint thinner — chemical contamination, often serious
- Electrical burning — avionics or wiring issue
- Jet fuel or burnt oil — engine/APU bleed contamination
- Acrid or chemical — broad category, probe for location and onset
- "Vomit smell" — sometimes used to describe oil pyrolysis byproducts

COMMON SOURCES — ask about these if not volunteered:
- Bleed air system / pack failure (securing Pack 1 or 2 frequently dissipates fumes — ask if they tried this)
- APU start or bleed activation (many events triggered at APU on)
- Engine start, especially crossbleed starts
- Pack configuration changes (turning bleeds on/off)
- IFE/entertainment systems (electrical burning)
- Lavatory smoke detectors
- Passenger electronic devices (vape batteries, laptops)
- Coalescer bag failure
- Oil cooler failure

KEY TIMING PATTERNS — ask about these:
- Did fumes start at engine start, APU on, pushback, pack config change, or takeoff power?
- Did securing a pack dissipate the fumes? This is critical diagnostic data.
- Were fumes worse on ground vs. in flight?

CRITICAL QUESTIONS often missed in reports:
- What was the pack/bleed configuration when fumes started?
- Was APU on or off? Was it recently started?
- Did maintenance mark it NFF (No Fault Found)? This is a red flag — NFF tails frequently have repeat events.
- Has this tail had prior write-ups for similar events? NFF returns to service are a pattern.
- Were deadheading crew or jumpseaters on board who can corroborate?
- Did symptoms persist or worsen after deplaning? Many crews report delayed or worsening symptoms hours later.

OPERATIONAL PATTERNS to document:
- Crew on oxygen? Masks donned?
- QRH / smoke-fire-fumes checklist run?
- Priority handling requested with ATC?
- Diversion or return to field?
- Aircraft removed from service or returned?
- Medical services called? Who made that call?

NFF WARNING — if they mention maintenance said "no fault found" or the aircraft was quickly returned to service, note this prominently. ASRS data shows NFF tails have disproportionate repeat events. Flag it.

AIRBUS A320 TSM REQUIRED FIELDS
After the initial narrative and symptoms are captured, tell the pilot: "I have a few quick configuration questions — maintenance needs these to run the fault isolation procedure."

Then work through these efficiently — group related questions together where possible:

- Start method: APU Bleed or Air Starter Unit?
- Was ground air or A/C packs used at the gate?
- Any engine power level changes during or just before the event? (e.g. top of descent)
- APU Bleed: On or Off at time of event?
- Isolation/Cross Bleed Valve: Open or Closed?
- Pack 1 and Pack 2: On or Off? (ask together)
- Bleed 1 and Bleed 2: On or Off? (ask together)
- Affected area: Cockpit, Cabin, or Both?
- Specific area within the aircraft if known?
- Was the aircraft deiced prior to the event?
- Level of odor: A (Temporary), B (Persistent), or C (Continuous and Discomfortable)?

Group them smartly — Packs and Bleeds together, Start Method and Ground Air together. Aim to cover all fields in 3-4 messages max. If they don't know an answer, accept "unknown" and move on. Do NOT generate the report until these fields are captured or explicitly marked unknown.

CORROBORATING DATA
- Ask who else noticed or was affected: other flight deck crew, flight attendants, passengers.
- Ask whether maintenance was notified and whether a write-up was logged in the AML.
- Frame these as "help me get the full picture" — never as doubting the pilot.

FLOW
1. Keep messages short — this is SMS.
2. Don't ask things they've already told you.
3. When you have a reasonable picture, say: "I think I've got enough — reply REPORT and I'll generate the ESC report."
4. Always close with: "If you want to talk through this more, send a DART to your Environmental Standards Committee or a CIRP through the ALPA app."

NEVER
- Never sound like a form.
- Never use bullets, numbered lists, or long paragraphs — this is SMS.
- Never minimize what they're describing.
- Never suggest urgent care. Occupational medicine for non-emergency follow-up only.`;

// ── REPORT PROMPT ─────────────────────────────────────────────────────────────
const REPORT_PROMPT = `You are generating a structured ESC fume/odor event report from an SMS intake conversation.

Output ONLY valid JSON. No prose, no markdown fences.

Severity 1-4 (AQP-style, weight toward middle):
1 - Non-event: odor noticed, no symptoms, no operational impact.
2 - Possible fume event: recognizable odor, mild symptoms, no operational impact.
3 - Confirmed fume event: clear odor, moderate symptoms, possible operational impact. Most real events.
4 - Serious fume event: neurological symptoms, emergency declared, diversion, multiple crew/pax affected.

Odor level (Airbus standard):
A - Temporary
B - Persistent
C - Continuous and Discomfortable

Schema:
{
  "event_time_zulu": "string or null — time of event in Zulu/UTC format e.g. 1430Z",
  "tail_number": "string or null",
  "departure": "string or null",
  "arrival": "string or null",
  "divert": "yes / no / unknown",
  "phase_of_flight": "string or null",
  "odor_description": "string or null",
  "crew_symptoms_at_event": "string or null",
  "crew_symptoms_current": "string or null",
  "operational_impact": "string or null",
  "maintenance_log_status": "string or null",
  "others_affected": "string or null",
  "severity_rating": "1 / 2 / 3 / 4",
  "start_method": "APU Bleed / Air Starter Unit / unknown",
  "ground_air_or_packs_at_gate": "Ground Air / A/C Packs / Neither / unknown",
  "engine_pwr_level_changes": "yes / no / unknown",
  "apu_bleed": "on / off / unknown",
  "cross_bleed_valve": "open / closed / unknown",
  "pack_1": "on / off / unknown",
  "pack_2": "on / off / unknown",
  "bleed_1": "on / off / unknown",
  "bleed_2": "on / off / unknown",
  "affected_area": "cockpit / cabin / both / unknown",
  "specific_area": "string or null",
  "aircraft_deiced": "yes / no / unknown",
  "odor_level": "A / B / C / unknown",
  "narrative": "1 paragraph, third person past tense",
  "additional_notes": "string or null",
  "flagged": "true / false",
  "flag_reason": "string or null"
}

If a field was not discussed use null. Do not invent details.`;

// ── GOOGLE SHEETS ─────────────────────────────────────────────────────────────
async function writeToSheet(report) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const row = [
      new Date().toISOString(),
      report.event_time_zulu,
      report.tail_number,
      report.departure,
      report.arrival,
      report.divert,
      report.phase_of_flight,
      report.odor_description,
      report.crew_symptoms_at_event,
      report.crew_symptoms_current,
      report.operational_impact,
      report.maintenance_log_status,
      report.others_affected,
      report.severity_rating ? parseInt(report.severity_rating) : null,
      report.start_method,
      report.ground_air_or_packs_at_gate,
      report.engine_pwr_level_changes,
      report.apu_bleed,
      report.cross_bleed_valve,
      report.pack_1,
      report.pack_2,
      report.bleed_1,
      report.bleed_2,
      report.affected_area,
      report.specific_area,
      report.aircraft_deiced,
      report.odor_level,
      report.narrative,
      report.additional_notes,
      report.flagged || 'false',
      report.flag_reason || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Form Responses 1!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] },
    });

    return true;
  } catch (err) {
    console.error('Sheet write error:', err);
    return false;
  }
}

// ── TWILIO WEBHOOK ────────────────────────────────────────────────────────────
app.post('/sms', async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const history = getConversation(from);

  // REPORT trigger
  if (body.toUpperCase() === 'REPORT') {
    const userMessages = history.filter(m => m.role === 'user');
    if (userMessages.length < 3) {
      twiml.message("I want to make sure I have enough to build a solid report. Can you tell me a bit more — tail number, route, and what the odor was like?");
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const transcript = history
      .map(m => `${m.role === 'user' ? 'CREW' : 'INTAKE'}: ${m.content}`)
      .join('\n\n');

    const checkResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Review this intake transcript and reply with ONLY "ready" if it contains at minimum: some odor/event description AND either a tail number or route. Otherwise reply with a single short SMS-style question asking for the single most important missing piece of information.\n\nTranscript:\n${transcript}`
      }]
    });

    const checkResult = checkResp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().toLowerCase();

    if (!checkResult.startsWith('ready')) {
      twiml.message(checkResult);
      res.type('text/xml').send(twiml.toString());
      return;
    }

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: REPORT_PROMPT,
        messages: [{ role: 'user', content: 'Transcript:\n\n' + transcript }],
      });

      const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const report = JSON.parse(cleaned);
      const saved = await writeToSheet(report);

      if (saved) conversations[from] = { messages: [], lastActivity: Date.now() };

      const flagNote = report.flagged === 'true' ? '\n\n⚠️ This report has been flagged for ESC review.' : '';

      twiml.message(saved
        ? `Report submitted to ESC. Severity: ${report.severity_rating}/4.${flagNote}\n\nIf you want to talk through this more, send a DART to your ESC or a CIRP through the ALPA app.`
        : `Report generated but sheet write failed. Screenshot this and send to your ESC rep.\n\nSeverity: ${report.severity_rating}/4`
      );
    } catch (err) {
      console.error('Report error:', err);
      twiml.message("Something went wrong generating the report. Reply REPORT to try again.");
    }

    res.type('text/xml').send(twiml.toString());
    return;
  }

  // RESET trigger
  if (body.toUpperCase() === 'RESET') {
    conversations[from] = { messages: [], lastActivity: Date.now() };
    twiml.message("Hey — a few things before we start. This conversation is completely confidential. No names, employee numbers, or identifying details are recorded or saved. This exists purely to help the ESC build data to better serve the pilot group. Thank you for taking the time — it matters. When you're ready, tell me what happened in your own words.");
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Normal conversation turn
  history.push({ role: 'user', content: body });
  const isFirst = history.length === 1;

  if (isFirst) {
    const welcomeReply = "Hey — a few things before we start. This conversation is completely confidential. No names, employee numbers, or identifying details are recorded or saved. This exists purely to help the ESC build data to better serve the pilot group. Thank you for taking the time — it matters. When you're ready, tell me what happened in your own words.";
    history.push({ role: 'assistant', content: welcomeReply });
    twiml.message(welcomeReply);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Also fire welcome if no assistant response yet
  const hasAssistantResponse = history.some(m => m.role === 'assistant');
  if (!hasAssistantResponse) {
    const welcomeReply = "Hey — a few things before we start. This conversation is completely confidential. No names, employee numbers, or identifying details are recorded or saved. This exists purely to help the ESC build data to better serve the pilot group. Thank you for taking the time — it matters. When you're ready, tell me what happened in your own words.";
    history.push({ role: 'assistant', content: welcomeReply });
    twiml.message(welcomeReply);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  try {
    const messages = history;

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    history.push({ role: 'assistant', content: reply });

    if (reply.length > 1500) {
      const mid = reply.lastIndexOf(' ', 1500);
      twiml.message(reply.slice(0, mid));
      twiml.message(reply.slice(mid + 1));
    } else {
      twiml.message(reply);
    }
  } catch (err) {
    console.error('Claude error:', err);
    twiml.message("Something went wrong on my end. Try sending that again.");
  }

  res.type('text/xml').send(twiml.toString());
});

// Health check
app.get('/', (req, res) => res.send('Debrief+ is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Debrief+ listening on port ${PORT}`));
