// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title AnchorRegistry
/// @notice Records Git tree hashes and SBOM hashes for software releases, keyed by a self-chosen
///         project identifier and a reference name. Submission is restricted to accounts a project
///         owner has allowlisted; reading is unrestricted.
/// @dev No upgradeability proxy and no administrative role. See "Contract design" in README.md.
contract AnchorRegistry {
    uint8 public constant KIND_TAG = 0;
    uint8 public constant KIND_SNAPSHOT = 1;

    struct Project {
        address owner;
        string label;
    }

    /// @dev Field order is deliberate: timestamp, submitter and revision pack into one slot
    ///      (8 + 20 + 4 bytes), giving three slots total. Reordering adds a slot to every anchor.
    struct Anchor {
        bytes32 treeHash;
        bytes32 sbomHash;
        uint64 timestamp;
        address submitter;
        uint32 revision;
    }

    mapping(bytes32 => Project) private _projects;
    mapping(bytes32 => mapping(address => bool)) private _allowlist;
    mapping(bytes32 => Anchor) private _anchors;

    error ProjectIdZero();
    error ProjectAlreadyRegistered(bytes32 projectId);
    error ProjectNotRegistered(bytes32 projectId);
    error NotProjectOwner(bytes32 projectId, address caller);
    error NotAllowlisted(bytes32 projectId, address caller);
    error UnknownKind(uint8 kind);
    error TreeHashZero();
    error EmptyRef();
    error ZeroAddress();

    event ProjectRegistered(bytes32 indexed projectId, address indexed owner, string label);
    event OwnershipTransferred(bytes32 indexed projectId, address indexed from, address indexed to);
    event AllowlistChanged(bytes32 indexed projectId, address indexed account, bool allowed);

    /// @dev `ref` must stay unindexed. Indexing a string keeps only its hash and drops the value,
    ///      which would leave a verifier unable to enumerate a project's anchored references.
    event AnchorSubmitted(
        bytes32 indexed projectId,
        uint8 indexed kind,
        string ref,
        bytes32 treeHash,
        bytes32 sbomHash,
        address submitter,
        uint32 revision
    );

    modifier onlyProjectOwner(bytes32 projectId) {
        address owner = _projects[projectId].owner;
        if (owner == address(0)) revert ProjectNotRegistered(projectId);
        if (owner != msg.sender) revert NotProjectOwner(projectId, msg.sender);
        _;
    }

    /// @notice Claims an unused project identifier. First come, first served.
    function registerProject(bytes32 projectId, string calldata label) external {
        if (projectId == bytes32(0)) revert ProjectIdZero();
        if (_projects[projectId].owner != address(0)) revert ProjectAlreadyRegistered(projectId);

        _projects[projectId] = Project({owner: msg.sender, label: label});
        _allowlist[projectId][msg.sender] = true;

        emit ProjectRegistered(projectId, msg.sender, label);
        emit AllowlistChanged(projectId, msg.sender, true);
    }

    /// @notice Records a tree hash and SBOM hash for a project reference. Re-anchoring an existing
    ///         reference supersedes the stored record and increments its revision.
    function anchor(
        bytes32 projectId,
        uint8 kind,
        string calldata ref,
        bytes32 treeHash,
        bytes32 sbomHash
    ) external {
        if (_projects[projectId].owner == address(0)) revert ProjectNotRegistered(projectId);
        if (!_allowlist[projectId][msg.sender]) revert NotAllowlisted(projectId, msg.sender);
        if (kind > KIND_SNAPSHOT) revert UnknownKind(kind);
        if (treeHash == bytes32(0)) revert TreeHashZero();
        if (bytes(ref).length == 0) revert EmptyRef();

        bytes32 key = anchorKey(projectId, kind, ref);
        uint32 revision = _anchors[key].revision + 1;

        _anchors[key] = Anchor({
            treeHash: treeHash,
            sbomHash: sbomHash,
            timestamp: uint64(block.timestamp),
            submitter: msg.sender,
            revision: revision
        });

        emit AnchorSubmitted(projectId, kind, ref, treeHash, sbomHash, msg.sender, revision);
    }

    function allowlistAdd(bytes32 projectId, address account) external onlyProjectOwner(projectId) {
        if (account == address(0)) revert ZeroAddress();
        _allowlist[projectId][account] = true;
        emit AllowlistChanged(projectId, account, true);
    }

    /// @notice Revokes an account's authority to anchor for this project.
    function allowlistRemove(bytes32 projectId, address account) external onlyProjectOwner(projectId) {
        _allowlist[projectId][account] = false;
        emit AllowlistChanged(projectId, account, false);
    }

    /// @dev The outgoing owner keeps its allowlist entry so a handover does not break a running
    ///      pipeline mid-release; the incoming owner can revoke it.
    function transferOwnership(bytes32 projectId, address newOwner) external onlyProjectOwner(projectId) {
        if (newOwner == address(0)) revert ZeroAddress();

        _projects[projectId].owner = newOwner;
        _allowlist[projectId][newOwner] = true;

        emit OwnershipTransferred(projectId, msg.sender, newOwner);
        emit AllowlistChanged(projectId, newOwner, true);
    }

    /// @notice Returns a zeroed struct for a reference never anchored.
    function getAnchor(bytes32 projectId, uint8 kind, string calldata ref)
        external
        view
        returns (Anchor memory)
    {
        return _anchors[anchorKey(projectId, kind, ref)];
    }

    function getProject(bytes32 projectId) external view returns (address owner, string memory label) {
        Project storage project = _projects[projectId];
        return (project.owner, project.label);
    }

    function isAllowlisted(bytes32 projectId, address account) external view returns (bool) {
        return _allowlist[projectId][account];
    }

    /// @notice Exposed so off-chain tooling derives storage keys identically to the contract.
    function anchorKey(bytes32 projectId, uint8 kind, string calldata ref)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(projectId, kind, ref));
    }
}
