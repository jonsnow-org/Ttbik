// One place that says whether the persistent graphical desktop (the metered Daytona VM behind the cloud_computer_* tools) may be used.
// Production policy (owner: everything is free, anything paid is a red line): it may not. Only tests exercise it with a fake provider.
// While it is off, the models are not offered cloud_computer_* tools (every call would fail and cost a full slow model step); their computer is the
// task-scoped Linux box (sandbox_* tools: Oracle Always Free runner, with the in-process JavaScript runner as the fallback).
export const cloudDesktopEnabled = (): boolean => process.env.NODE_ENV === "test";
