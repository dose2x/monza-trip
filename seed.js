// Public defaults only. The real plan (days, bookings, lists, route) is kept in the private trip
// database and reaches each phone by sync once it has the trip code.
const TRIP_DEFAULTS = {
  id: 'settings',
  type: 'setting',
  start: '2027-09-03',
  end: '2027-09-05',
  budget: 0,
  rateEUR: 1.15,
  rateCHF: 1.25,
  title: '',
};

const SEED = [];
