const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');

const initialState = {
  processedEvents: [],
  fulfillmentJobs: [],
  paymentFollowups: [],
  queueJobs: [],
  deadLetters: []
};

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2));
  }
}

function normalizeState(state) {
  return {
    processedEvents: state.processedEvents || [],
    fulfillmentJobs: state.fulfillmentJobs || [],
    paymentFollowups: state.paymentFollowups || [],
    queueJobs: state.queueJobs || [],
    deadLetters: state.deadLetters || []
  };
}

function readState() {
  ensureStore();
  const content = fs.readFileSync(stateFile, 'utf8').trim();

  if (!content) {
    writeState(initialState);
    return normalizeState(initialState);
  }

  try {
    return normalizeState(JSON.parse(content));
  } catch (error) {
    writeState(initialState);
    return normalizeState(initialState);
  }
}

function writeState(state) {
  ensureStore();
  const tempFile = `${stateFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalizeState(state), null, 2));
  fs.renameSync(tempFile, stateFile);
}

function updateState(updater) {
  const currentState = readState();
  const nextState = updater(normalizeState(currentState));
  writeState(nextState);
  return normalizeState(nextState);
}

function findProcessedEvent(eventId) {
  const state = readState();
  return state.processedEvents.find((event) => event.id === eventId) || null;
}

function saveProcessedEvent(eventRecord) {
  updateState((state) => {
    state.processedEvents.push(eventRecord);
    return state;
  });

  return eventRecord;
}

function saveFulfillmentJob(job) {
  updateState((state) => {
    state.fulfillmentJobs.push(job);
    return state;
  });

  return job;
}

function updateFulfillmentJob(jobId, updater) {
  updateState((state) => {
    const index = state.fulfillmentJobs.findIndex((job) => job.id === jobId);

    if (index >= 0) {
      state.fulfillmentJobs[index] = updater(state.fulfillmentJobs[index]);
    }

    return state;
  });
}

function savePaymentFollowup(followup) {
  updateState((state) => {
    state.paymentFollowups.push(followup);
    return state;
  });

  return followup;
}

function updatePaymentFollowup(followupId, updater) {
  updateState((state) => {
    const index = state.paymentFollowups.findIndex((followup) => followup.id === followupId);

    if (index >= 0) {
      state.paymentFollowups[index] = updater(state.paymentFollowups[index]);
    }

    return state;
  });
}

function saveQueueJob(job) {
  updateState((state) => {
    state.queueJobs.push(job);
    return state;
  });

  return job;
}

function findQueueJobByEventId(eventId) {
  const state = readState();
  return state.queueJobs.find((job) => job.eventId === eventId) || null;
}

function updateQueueJob(jobId, updater) {
  let updatedJob = null;

  updateState((state) => {
    const index = state.queueJobs.findIndex((job) => job.id === jobId);

    if (index >= 0) {
      state.queueJobs[index] = updater(state.queueJobs[index]);
      updatedJob = state.queueJobs[index];
    }

    return state;
  });

  return updatedJob;
}

function getRecoverableQueueJobs() {
  const state = readState();
  return state.queueJobs.filter((job) => job.status === 'queued' || job.status === 'processing');
}

function saveDeadLetter(deadLetter) {
  updateState((state) => {
    state.deadLetters.push(deadLetter);
    return state;
  });

  return deadLetter;
}

function getAllState() {
  return readState();
}

module.exports = {
  findProcessedEvent,
  saveProcessedEvent,
  saveFulfillmentJob,
  updateFulfillmentJob,
  savePaymentFollowup,
  updatePaymentFollowup,
  saveQueueJob,
  findQueueJobByEventId,
  updateQueueJob,
  getRecoverableQueueJobs,
  saveDeadLetter,
  getAllState
};

// Made with Bob
