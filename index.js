const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CONVERSATION STORE ────────────────────────────────────────────────────────
const conversations = {};

function getConversation(from) {
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (!conversations[from]) {
    conversations[from] = { messages: [], lastActivity: now };
  }

  if (now - conversations[from].lastActivity > TWENTY_FOUR_HOURS) {
    conversations[from] = { messages: [], lastActivity: now };
  }

  conversations[from].lastActivity = now;
  return conversations[from].messages;
}

const WELCOME = "Debrief+ — confidential fume event reporting for the ESC. No names, employee numbers, or personal identifiers are stored. Reports are tied to the flight and aircraft only, not to you personally — FOQA style. To get started: what was the date, local departure time, flight number, and tail number?";
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
- Flight number, date, and tail number — collected upfront in the opening message
- Route (departure and arrival)
- Phase of flight
- Odor/smoke: what it smelled like, where noticed, visible haze or smoke
- Symptoms — theirs and crew — at the time AND right now
- Operational impact (masks, emergency, diversion, gate return)
- Time of event — ask "What time did you notice it, local time?" then ask what timezone, convert to Zulu (UTC), and confirm with the pilot before moving on.
- Maintenance write-up: if they've written it or plan to, encourage them to be as descriptive as possible — specific smells, locations, durations, who noticed it. A detailed write-up forces maintenance to do more thorough troubleshooting.
- Anything else they want noted

MEDICAL GUIDANCE
- If symptoms sound mild (headache, mild nausea): document thoroughly, don't push medical advice.
- If they ask about follow-up: occupational medicine is the right referral — they can actually run the relevant tests.
- Only if something sounds genuinely serious (chest pain, difficulty breathing, altered consciousness): tell them to get help now. ER only — not urgent care.

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

SEVERITY ASSESSMENT (AQP-style 1–4)
As you gather information, maintain a running assessment of severity. Use the criteria below. Severity can only move UP — never down — as new information emerges. The final severity and justification will be written into the report.

LEVEL 1 — Subclinical
Odor detected. No symptoms in any crew member. No operational impact. QRH run preventively or not at all. Maintenance signal only.

LEVEL 2 — Mild, resolved
Symptoms were present during the event (eye/nose/throat irritation, transient headache, brief nausea, mild cough, brief lightheadedness) but are fully resolved by the time of this report. No oxygen use. No diversion. No medical attention sought. Pilot feels fit to fly next leg.

LEVEL 3 — Moderate / persistent
Any of the following: any symptom still present at time of report; any moderate-severity symptom during the event (brain fog, difficulty concentrating, paresthesias/tingling/numbness, dyspnea or chest tightness, tremor, vision changes, palpitations, persistent or worsening headache, vomiting, dizziness with balance disturbance); diversion considered but not executed; medical attention sought or planned; pilot unsure about fitness for next leg; multiple crew affected.

LEVEL 4 — Severe / sentinel
Any of the following: oxygen used in flight by any crew member; crew incapacitation (any duration); diversion executed or emergency declared; loss of consciousness or near-syncope; sustained chest pain or severe respiratory distress; sustained confusion or disorientation; crew member unable to perform duties; multiple symptomatic crew across categories (pilots AND flight attendants); pilot states they are not fit to fly next leg; symptoms worsening rather than resolving in the hours after the event.

SEVERITY UPGRADE RULE
If the pilot reports worsening at any point — including the longitudinal check-in messages — the severity must be upgraded to reflect the new information. Log the reason for any upgrade in the justification field.

SYMPTOM INTELLIGENCE
Use the symptom catalogue below to ask smarter follow-up questions and recognize clinically significant patterns. A single mild symptom (runny nose, brief headache) is common and non-specific. A cluster of symptoms across organ systems is a different picture entirely.

MILD / NON-SPECIFIC (probe gently, document accurately):
- Eye irritation, tearing, burning
- Nose and sinus irritation, runny nose
- Mild throat irritation or sore throat
- Mild headache (transient)
- Brief lightheadedness
- Mild nausea without vomiting
- Mild cough
- Skin or mucous membrane irritation

MODERATE (warrant follow-up, flag if persisting):
- Persistent or worsening headache
- Dizziness with balance disturbance
- Vomiting
- Dyspnea or chest tightness during event
- Tremor or shakiness
- Paresthesias — tingling, numbness, especially distal or perioral
- Brain fog, difficulty concentrating, slowed thinking
- Diarrhea, abdominal cramps, excessive saliva (muscarinic pattern — organophosphate signal)
- Palpitations
- Significant fatigue
- Vision changes — blurred, difficulty focusing

SEVERE (immediate flag, Level 4 automatic):
- Loss of consciousness or near-syncope
- Sustained confusion or disorientation
- Crew member unable to perform duties
- Supplemental or emergency oxygen used during event
- Sustained chest pain
- Severe respiratory distress
- Nystagmus, marked tremor, impaired speech, gait disturbance
- Seizure or seizure-like activity

PATTERN RECOGNITION — if a pilot reports symptoms across multiple organ systems (e.g., headache + paresthesias + brain fog, or nausea + chest tightness + vision changes), treat this as a higher-severity cluster regardless of how mild each individual symptom sounds. Document each symptom explicitly.

SUBACUTE SYMPTOMS — ask about these if the event was more than a few hours ago:
- Chemical sensitivity (new intolerance to odors, fuel smells, cleaning products)
- Sleep disturbance
- Persistent cognitive symptoms — memory, word-finding, concentration
- Exercise intolerance
- Persistent cough or reactive airway symptoms
- Mood changes — anxiety, low mood

FLOW
1. Keep messages short — this is SMS.
2. Don't ask things they've already told you.
3. When you have a reasonable picture, say: "I think I've got enough — reply REPORT and I'll generate the ESC report."
4. Always close with: "If you want to talk through this more, send a DART to your Environmental Standards Committee or a CIRP through the ALPA app."

NEVER
- Never sound like a form.
- Never use bullets, numbered lists, or long paragraphs — this is SMS.
- Never minimize what they're describing.
- Never suggest urgent care. Occupational medicine or ER only.`;

// ── REPORT PROMPT ─────────────────────────────────────────────────────────────
const REPORT_PROMPT = `You are generating a structured ESC fume/odor event report from an SMS intake conversation.

Output ONLY valid JSON. No prose, no markdown fences.

SEVERITY RUBRIC (AQP-style 1–4):
1 - Subclinical: Odor detected, no symptoms in any crew, no operational impact. QRH preventive or not run. Maintenance signal only.
2 - Mild, resolved: Symptoms present during event (eye/nose/throat irritation, transient headache, brief nausea) but fully resolved by time of report. No oxygen use, no diversion, no medical attention sought. Pilot fit to fly.
3 - Moderate / persistent: Any symptom still present at time of report. OR any moderate-severity symptom during event (brain fog, paresthesias, dyspnea, tremor, vision changes, vomiting, balance disturbance, palpitations). OR diversion considered, medical attention sought, pilot unsure about fitness for next leg, multiple crew affected.
4 - Severe / sentinel: Any of — oxygen used in flight, crew incapacitation, diversion executed, emergency declared, loss of consciousness, sustained chest pain, severe respiratory distress, sustained confusion, crew unable to perform duties, multiple crew across categories (pilots AND FAs), pilot not fit to fly next leg, symptoms worsening post-event.

SEVERITY UPGRADE RULE: Severity can only move UP. If longitudinal follow-up data indicates worsening, upgrade accordingly and document in severity_justification.

SEVERITY JUSTIFICATION: Write a concise 1-2 sentence explanation citing the specific symptoms, operational factors, or timeline data that drove the severity assignment. Be specific — name the symptoms and the criteria they meet. This is the audit trail for the ESC to review the bot's reasoning.

Odor level (Airbus standard):
A - Temporary
B - Persistent
C - Continuous and Discomfortable

Schema:
{
  "event_date": "string or null — date of event in YYYY-MM-DD format",
  "event_time_zulu": "string or null — time of event in Zulu/UTC format e.g. 1430Z",
  "flight_number": "string or null",
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
  "severity_justification": "string — concise explanation of what drove this severity score, citing specific symptoms and criteria",
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

// ── POST-REPORT RESOURCES ─────────────────────────────────────────────────────
const RESOURCES = {
  menu: `Report is in with the ESC. Here's what to do next — reply with a number:\n1 - Required reports to file\n2 - Medical guidance\n3 - ALPA resources\n4 - All of the above`,

  reports: `Required reports — wait until adrenaline recedes before filing:\n\nASAP Report: within 24hrs of completing trip via ProSafeT.\n\nHazard Report: within 36hrs via ProSafeT. One event/one report.\n\nHave both reviewed by FFT Legal before submitting: FFTLRC@alpa.org\n\nChief Pilot notification required only if medical attention was needed or passengers were injured. Duty phone: [DUTY-PHONE]`,

  medical_1: `If you feel ill now or within the next 3 days — go to an ER. Not urgent care. Urgent care cannot run the required tests.\n\nTell the ER doctor:\n"I am a commercial airline pilot. I have suffered an acute occupational exposure to pyrolyzed aviation synthetic engine oils and bleed air contaminants in a confined space."`,

  medical_2: `Request these specific tests:\n- Carboxyhemoglobin (COHb) — carbon monoxide\n- Arterial Blood Gas (ABG) — lung function\n- RBC Cholinesterase — organophosphate/TCP exposure\n- Comprehensive Metabolic Panel (CMP) — organ function\n- VOC Screen — identify specific chemical agents\n\nBring the UCSF Health Care Provider Guide from the ALPA App.\n\nALPA Aeromedical (Mon-Fri 0830-1600 MT): [AEROMEDICAL-PHONE]`,

  alpa: `ALPA Resources:\n\nAeromedical guidance (Mon-Fri 0830-1600 MT): [AEROMEDICAL-PHONE]\n\nFume Guidance: Check the ALPA App under member resources.\n\nIATA Smoke and Fumes Report: Send to EAS@alpa.org and FFTsafety@alpa.org\n\nNeed to talk? Send a DART to your Environmental Standards Committee or request a CIRP debrief through the ALPA app. Both are confidential.`,
};

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
      report.event_date,
      report.event_time_zulu,
      report.flight_number,
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
      report.severity_justification || '',
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

  // FOLLOWUP trigger — always works regardless of conversation state
  const bodyUpper = body.toUpperCase();
  if (bodyUpper === 'FOLLOWUP' || bodyUpper === 'FOLLOW UP' || bodyUpper === 'FOLLOW-UP') {
    twiml.message(RESOURCES.menu);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Resource menu responses — always work regardless of conversation state
  if (body === '1') {
    twiml.message(RESOURCES.reports);
    res.type('text/xml').send(twiml.toString());
    return;
  }
  if (body === '2') {
    twiml.message(RESOURCES.medical_1);
    twiml.message(RESOURCES.medical_2);
    res.type('text/xml').send(twiml.toString());
    return;
  }
  if (body === '3') {
    twiml.message(RESOURCES.alpa);
    res.type('text/xml').send(twiml.toString());
    return;
  }
  if (body === '4') {
    twiml.message(RESOURCES.reports);
    twiml.message(RESOURCES.medical_1);
    twiml.message(RESOURCES.medical_2);
    twiml.message(RESOURCES.alpa);
    res.type('text/xml').send(twiml.toString());
    return;
  }

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

    try {
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

      const closingMessage = `Thanks for filing. If you need support, you can send a DART to ESC or contact CIRP anytime. Your ESC is also building a long-term health dataset — if you're willing to help, it takes about 5 minutes and is completely anonymous: [LONGTERM-FORM-LINK]`;

      twiml.message(saved
        ? `Report submitted to the ESC.${flagNote}\n\n${RESOURCES.menu}`
        : `Report generated but sheet write failed. Screenshot this and send to your ESC rep.`
      );

      if (saved) {
        twiml.message(closingMessage);
      }

    } catch (err) {
      console.error('Report error:', err);
      twiml.message("Something went wrong generating the report. Reply REPORT to try again.");
    }

    // Guaranteed response — if twiml has no messages yet something went very wrong
    if (!twiml.toString().includes('<Message>')) {
      twiml.message("Report received. Something went wrong on our end — please reply REPORT to try again or text FOLLOWUP for resources.");
    }

    res.type('text/xml').send(twiml.toString());
    return;
  }

  // RESET trigger
  if (body.toUpperCase() === 'RESET') {
    conversations[from] = { messages: [], lastActivity: Date.now() };
    twiml.message("Hey — a few things before we start. This conversation is completely confidential. No names, employee numbers, or identifying details are recorded or saved. This exists to help the ESC build data to serve the pilot group — and to be a resource for you moving forward. Thank you for taking the time — it matters. When you're ready, tell me what happened in your own words.");
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
