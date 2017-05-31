'use strict';
const co = require('co');
const winston = require('winston');

const nb = require('./lib/nation-builder');

const NBAPIKey = process.env.NB_API_KEY_3;
const NBNationSlug = process.env.NB_SLUG;
const user = process.env.AUTH_USER;
const password = process.env.AUTH_PASSWORD;

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const api = require('@fi/api-client');
const client = api.createClient({
  endpoint: 'http://localhost:8000/legacy',
  clientId: user,
  clientSecret: password
});


winston.configure({
  level: LOG_LEVEL,
  transports: [
    new (winston.transports.Console)()
  ]
});

const rsvp_type = {
  events: 'rsvps',
  groups: 'memberships',
};

const personTable = {};

const importRSVPs = co.wrap(function*(forever = true) {

  do {
    for (let resource of ['events', 'groups']) {
      winston.profile(`import_RSVPs_${resource}`);
      winston.info(`cycle starting, ${resource}`);
      try {
        // let's first fetch all events/groups
        let items = yield client[resource].list({max_results: 2000});

        // handle RSVPS using ten concurrent 'threads' of execution
        // could be handled better
        for (let i = 0; i < items.length; i += 5) {
          yield items.slice(i, i + 5).map(item => updateItem(resource, item));
        }
      } catch (err) {
        //winston.error(`Failed  handling ${resource}`, {message: err.message});
        console.log(err);
        throw(err);
      }
      winston.profile(`import_RSVPs_${resource}`);
    }
  } while (forever);
});


const updateItem = co.wrap(function*(resource, item) {
  let importRSVPs = [];

  let fetchRSVPs = nb.fetchAll(NBNationSlug, `sites/${NBNationSlug}/pages/events/${item.id}/rsvps`, {NBAPIKey});
  while (fetchRSVPs !== null) {
    let rsvps;
    [rsvps, fetchRSVPs] = yield fetchRSVPs();
    if (rsvps) {
      // now update all people referred in the RSVPS
      for (let i = 0; i < rsvps.length; i++) {
        const personId = yield getPersonURL(rsvps[i].person_id);

        if (personId) {
          importRSVPs.push({
            person: yield getPersonURL(rsvps[i].person_id),
            canceled: rsvps[i].canceled,
            guests: rsvps[i].guests_count || 0
          });
        }
      }
    }
  }

  try {
    if(importRSVPs.length) {
      console.log('Not empty: ' + item._id);
    }
    yield item[rsvp_type[resource]].bulk.put(importRSVPs);
  } catch (err) {
    winston.error(`Error patching ${resource} ${item._id}`, {message: err.message});
    // temp
    throw(err);
  }

});

const getPersonURL = co.wrap(function *(personId) {
  if (! (personId in personTable)) {
    try {
      const person = yield client.people.getById(personId);
      personTable[personId] = person.url;
    } catch(err) {
      if (err instanceof api.exceptions.NotFoundError) {
        return null;
      }
      throw err;
    }
  }
  return personTable[personId];
});

importRSVPs();
