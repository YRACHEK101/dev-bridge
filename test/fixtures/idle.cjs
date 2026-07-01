// A process that just stays alive (never binds a port). Used to test process
// lifecycle/port-guard behavior without shell quoting.
setInterval(() => {}, 1 << 30);
