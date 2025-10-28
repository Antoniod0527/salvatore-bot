// src/App.js
import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import logo from "./salvatores-logo.png";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Initial greeting
    setMessages([
      {
        sender: "bot",
        text: "Ciao! I'm your Salvatore's assistant 🍷 — I can help you book a banquet or answer any questions about our restaurant.",
      },
    ]);
  }, []);

  // No cleaning needed - just return as-is
  function cleanStreamChunk(s) {
    return s || "";
  }

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { sender: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:3000/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.text,
          sessionId: sessionId || null,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response body from server");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let botMessage = "";
      const tempId = Date.now();

      // Add placeholder bot message
      setMessages((prev) => [...prev, { id: tempId, sender: "bot", text: "" }]);

      // Stream loop
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        
        console.log("📦 Raw SSE data:", raw);
        
        // Split by newlines to get SSE events
        const lines = raw.split("\n");
        
        for (const line of lines) {
          // Skip empty lines
          if (!line.trim()) continue;
          
          // Only process lines that start with "data: "
          if (!line.startsWith("data: ")) continue;
          
          // Extract content after "data: "
          const content = line.substring(6); // Remove "data: " prefix
          
          console.log("📥 Raw content:", content);
          
          // Check for special markers
          if (content === "[DONE]") continue;
          
          if (content === "[BOOKING_SAVED]") {
            setTimeout(() => {
              setMessages((prev) => [
                ...prev,
                {
                  sender: "bot",
                  text: "✅ Perfect! Your booking has been confirmed and saved to our calendar. You'll receive a confirmation email shortly!",
                },
              ]);
            }, 500);
            continue;
          }

          // Check for sessionId (comes as JSON object)
          if (content.startsWith('{"sessionId"')) {
            try {
              const parsed = JSON.parse(content);
              if (parsed.sessionId && !sessionId) {
                console.log("Session ID received:", parsed.sessionId);
                setSessionId(parsed.sessionId);
              }
            } catch (err) {
              console.error("Error parsing sessionId:", err);
            }
            continue;
          }

          // Everything else is text content - convert \n to actual newlines
          const cleanContent = content.replace(/\\n/g, '\n');
          botMessage += cleanContent;
          console.log("📥 Current message:", botMessage);

          // Update UI immediately
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, text: botMessage } : m
            )
          );
        }
      }

      // No final cleanup needed - text should be clean now
      
      // Commit final message
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, text: botMessage } : m))
      );

      setLoading(false);
    } catch (err) {
      console.error("Fetch/stream error:", err);
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "Sorry — there was a connection issue. Please make sure the server is running on http://localhost:3000" },
      ]);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <img src={logo} alt="Salvatore's Italian Grill Logo" className="logo" />
        <h1>Salvatore's Banquet Assistant</h1>
      </header>

      <div className="chat-box">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.sender}`}>
            {msg.text}
          </div>
        ))}
        {loading && <div className="message bot typing">Typing…</div>}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-area" onSubmit={sendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default App;