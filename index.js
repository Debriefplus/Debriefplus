const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory conversation store keyed by phone number
const conversations = {};

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
- Aircraft type and tail number
- Route (departure and arrival)
- Phase of flight
- Odor/smoke: what it smelled like, where noticed, visible haze or smoke
- Symptoms — theirs and crew — at the time AND right now
- Operational impact (masks, emergency, diversion, gate return)
- Maintenance write-up: if they've written it or plan to, encourage them to be as descriptive as possible — specific smells, locations, durations, who noticed it. A detailed write-up forces maintenance to do more thorough troubleshooting.
- Anything else they want noted

MEDICAL GUIDANCE
- If symptoms sound mild (headache, mild nausea): document thoroughly, don't push medical advice.
- If they ask about follow-up: occupational medicine is the right referral — they can actually run the relevant tests.
- Only if something sounds genuinely serious (chest pain, difficulty breathing, altered consciousness): tell them to get help now.

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
- Never send urgent care. Occupational medicine for non-emergency follow-up only.`;

// ── REPORT PROMPT ─────────────────────────────────────────────────────────────
const REPORT_PROMPT = `You are generating a structured ESC fume/odor event report from an SMS intake conversation.

Output ONLY valid JSON. No prose, no markdown fences.

Severity 1-4 (AQP-style, weight toward middle):
1 - Non-event: odor noticed, no symptoms, no operational impact.
2 - Possible fume event: recognizable odor, mild symptoms, no operational impact.
3 - Confirmed fume event: clear odor, moderate symptoms, possible operational impact. Most real events.
4 - Serious fume event: neurological symptoms, emergency declared, diversion, multiple crew/pax affected.

Schema:
{
  "event_summary": "2-3 sentence summary",
  "aircraft_type": "string or null",
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
  "narrative": "1 paragraph, third person past tense",
  "additional_notes": "string or null"
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
      report.event_summary,
      report.aircraft_type,
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
      report.severity_rating,
      report.narrative,
      report.additional_notes,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:Q',
      valueInputOption: 'RAW',
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

  // Init conversation
  if (!conversations[from]) {
    conversations[from] = [];
  }

  const history = conversations[from];

  // REPORT trigger
  if (body.toUpperCase() === 'REPORT') {
    const transcript = history
      .map(m => `${m.role === 'user' ? 'CREW' : 'INTAKE'}: ${m.content}`)
      .join('\n\n');

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

      twiml.message(saved
        ? `Report submitted to ESC. Severity: ${report.severity_rating}/4.\n\nIf you want to talk through this more, send a DART to your ESC or a CIRP through the ALPA app.`
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
    conversations[from] = [];
    twiml.message("Conversation reset. When you're ready, just tell me what happened.");
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Normal conversation turn
  history.push({ role: 'user', content: body });

  // First message — prepend the welcome if this is the opening
  const isFirst = history.length === 1;

  try {
    const messages = isFirst
      ? [
          {
            role: 'user',
            content: 'SYSTEM: This is the first message from this pilot. Open with the confidentiality/purpose intro, thank them, then invite them to share what happened.',
          },
          { role: 'assistant', content: "Before we get into it — this is a chatbot that helps create reports for the Environmental Standards Committee. Nothing said here can be used against you. No identifying details are recorded or saved. This exists to help the ESC track, follow up, and prevent future fume events. Seriously, thank you for reaching out." },
          { role: 'user', content: body },
        ]
      : history;

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    history.push({ role: 'assistant', content: reply });

    // SMS has 1600 char limit per message — split if needed
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
