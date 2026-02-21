type HeapSnapshot = {
    snapshot: {
        meta: HeapSnapshotMeta;
        node_count: number;
        edge_count: number;
        trace_function_count: number;
    };
    nodes: number[];  // Flat array representing the nodes
    edges: number[];  // Flat array representing the edges
    trace_function_infos: any[];  // Information about functions
    trace_tree: any[];  // Execution traces
    samples: HeapSnapshotSamples;
    strings: string[];  // String table for node names
};

type HeapSnapshotMeta = {
    node_fields: string[];  // Describes the fields in `nodes` array
    node_types: Array<string[] | string>;  // Describes the types of `node_fields`
    edge_fields: string[];  // Describes the fields in `edges` array
    edge_types: Array<string[] | string>;  // Describes the types of `edge_fields`
    trace_function_info_fields: string[];
    trace_node_fields: string[];
    sample_fields: string[];
    location_fields: string[];
};

type HeapSnapshotSamples = {
    timestamps: number[];
    last_assigned_ids: number[];
};