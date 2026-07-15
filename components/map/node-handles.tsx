"use client";

import { Handle, Position } from "@xyflow/react";

/**
 * Every custom node carries the same set of (near-invisible) connection points:
 * one source and one target on each side. Edges pick a pair by id (s-l/s-t/s-r/
 * s-b, t-l/t-t/t-r/t-b) so the flow can enter/leave any side cleanly.
 */
export default function NodeHandles() {
  const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: "none" };
  return (
    <>
      <Handle id="t-l" type="target" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle id="t-t" type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle id="t-r" type="target" position={Position.Right} style={hidden} isConnectable={false} />
      <Handle id="t-b" type="target" position={Position.Bottom} style={hidden} isConnectable={false} />
      <Handle id="s-l" type="source" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle id="s-t" type="source" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle id="s-r" type="source" position={Position.Right} style={hidden} isConnectable={false} />
      <Handle id="s-b" type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
    </>
  );
}
