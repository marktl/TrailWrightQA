Run the `executing-plans-no-review` Skill to execute a plan without pauses.

Args:
- path: path to the plan markdown
- start-task: task number to start from

Do:
1) Activate `executing-plans-no-review`.
2) Run the plan at `{path}` starting at `{start-task}`.
3) Do not pause between batches; continue until complete.
4) Print final summary with commit SHAs.
