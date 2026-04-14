import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Fanzia — AI-Powered Growth for Local Businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#000000",
          color: "#ffffff",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* Red right panel */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "40%",
            backgroundColor: "#F13737",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Stylized F mark */}
          <div
            style={{
              fontSize: 360,
              fontWeight: 900,
              color: "#ffffff",
              lineHeight: 1,
              letterSpacing: -10,
            }}
          >
            F
          </div>
        </div>

        {/* Diagonal hatch overlay on red */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "40%",
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 18px)",
            display: "flex",
          }}
        />

        {/* Left content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "60px 70px",
            width: "60%",
            height: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 4,
              color: "#F13737",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                backgroundColor: "#F13737",
              }}
            />
            Glendale &amp; Los Angeles, CA
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: 120,
                fontWeight: 900,
                color: "#ffffff",
                lineHeight: 0.95,
                textTransform: "uppercase",
                letterSpacing: -4,
              }}
            >
              Fanzia.
            </div>
            <div
              style={{
                fontSize: 42,
                fontWeight: 700,
                color: "#ffffff",
                marginTop: 20,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              AI-Powered Growth
              <br />
              for Local Businesses.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 4,
              color: "#ffffff",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                width: 60,
                height: 2,
                backgroundColor: "#F13737",
              }}
            />
            Built by Operators. For Operators.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
