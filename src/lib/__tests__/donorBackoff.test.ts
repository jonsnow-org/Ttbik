// A candidate Studio answering 429 «Request limit exceeded» is waiting, not failing; a chat-template end marker never reaches the user.
import { donorJobPoll } from "@/lib/donorTests";

beforeEach(() => { process.env.MODELSCOPE_API_TOKEN = "t"; });

it("429 is asked again and then answered; Gemma's end marker is stripped", async () => {
  let n = 0;
  const fetchImpl = (async () => {
    n++;
    if (n <= 2) return new Response('{"error":{"message":"Request limit exceeded."}}', { status: 429 });
    return new Response(JSON.stringify({ data: [JSON.stringify({ state: "done", result: JSON.stringify({ text: "مرحبا<turn|>" }) })] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await donorJobPoll("gemma4-e4b", "job1", fetchImpl);
  expect(n).toBe(3);
  expect(r).toMatchObject({ state: "done", result: { text: "مرحبا" } });
});

it("a persistent 429 still ends as an error after the retries", async () => {
  let n = 0;
  const fetchImpl = (async () => { n++; return new Response("{}", { status: 429 }); }) as unknown as typeof fetch;
  await expect(donorJobPoll("gemma4-e4b", "job1", fetchImpl)).rejects.toThrow(/429/);
  expect(n).toBe(5);
});
