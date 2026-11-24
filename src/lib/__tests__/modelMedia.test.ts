import { modelMediaConfigured } from "@/lib/modelMedia";

const ENV_KEYS = [
  "NOVA_IMAGE_STUDIO_URL",
  "NOVA_MEDIA_STUDIO_URL",
  "NOVA2_MEDIA_STUDIO_URL",
  "OPEN_CODER_STUDIO_TOKEN",
  "MODELSCOPE_API_TOKEN",
  "MODELSCOPE_TOKEN",
  "NOVA2_MEDIA_STUDIO_TOKEN",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("model-owned media route preflight", () => {
  it("requires Nova's own image endpoint and a ModelScope credential", () => {
    expect(modelMediaConfigured("coder", "image")).toBe(false);

    process.env.MODELSCOPE_API_TOKEN = "test-token";
    expect(modelMediaConfigured("coder", "image")).toBe(true);

    process.env.NOVA_IMAGE_STUDIO_URL = "off";
    expect(modelMediaConfigured("coder", "image")).toBe(false);
  });

  it("does not advertise an image route with an invalid URL or missing credential", () => {
    process.env.NOVA_IMAGE_STUDIO_URL = "http://insecure.example";
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    expect(modelMediaConfigured("coder", "image")).toBe(false);

    process.env.NOVA_IMAGE_STUDIO_URL = "https://nova-image.example";
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(modelMediaConfigured("coder", "image")).toBe(false);
  });

  it("requires Nova's own media endpoint and its matching credential for audio and video", () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.example";
    expect(modelMediaConfigured("coder", "audio")).toBe(false);
    expect(modelMediaConfigured("coder", "video")).toBe(false);

    process.env.OPEN_CODER_STUDIO_TOKEN = "test-token";
    expect(modelMediaConfigured("coder", "audio")).toBe(true);
    expect(modelMediaConfigured("coder", "video")).toBe(true);

    process.env.NOVA_MEDIA_STUDIO_URL = "off";
    expect(modelMediaConfigured("coder", "audio")).toBe(false);
    expect(modelMediaConfigured("coder", "video")).toBe(false);
  });

  it("does not treat another model's private Studio as Nova's own route", () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://shared-media.example";
    process.env.NOVA2_MEDIA_STUDIO_URL = "https://shared-media.example";
    process.env.NOVA2_MEDIA_STUDIO_TOKEN = "nova2-only-token";
    expect(modelMediaConfigured("coder", "audio")).toBe(false);
    expect(modelMediaConfigured("nova2", "audio")).toBe(false);
  });

  it("does not borrow Nova's endpoint or token for Nova 2, Sham v2 or unknown models", () => {
    process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.example";
    process.env.OPEN_CODER_STUDIO_TOKEN = "test-token";
    expect(modelMediaConfigured("nova2", "audio")).toBe(false);
    expect(modelMediaConfigured("sham_v2", "video")).toBe(false);
    expect(modelMediaConfigured("unknown-model", "image")).toBe(false);
  });
});
