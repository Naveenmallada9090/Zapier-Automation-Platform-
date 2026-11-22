"use client";

import { BACKEND_URL } from "@/app/config";
import { Appbar } from "@/components/Appbar";
import { Input } from "@/components/Input";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { SecondaryButton } from "@/components/buttons/SecondaryButton";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, Edge, MarkerType, Node, Position } from "reactflow";
import "reactflow/dist/style.css";

type AvailableItem = {
    id: string;
    name: string;
    image: string;
}

function useAvailableActionsAndTriggers() {
    const [availableActions, setAvailableActions] = useState<AvailableItem[]>([]);
    const [availableTriggers, setAvailableTriggers] = useState<AvailableItem[]>([]);

    useEffect(() => {
        axios.get(`${BACKEND_URL}/api/v1/trigger/available`)
            .then(x => setAvailableTriggers(x.data.availableTriggers))

        axios.get(`${BACKEND_URL}/api/v1/action/available`)
            .then(x => setAvailableActions(x.data.availableActions))
    }, [])

    return {
        availableActions,
        availableTriggers
    }
}

type SelectedAction = {
    key: number;
    availableActionId: string;
    availableActionName: string;
    metadata: any;
}

type Stage = {
    key: number;
    actions: SelectedAction[];
}

type ModalTarget =
    | { kind: "trigger" }
    | { kind: "action", stageIndex: number, actionIndex: number };

export default function ZapCreate() {
    const router = useRouter();
    const { availableActions, availableTriggers } = useAvailableActionsAndTriggers();
    const [selectedTrigger, setSelectedTrigger] = useState<{
        id: string;
        name: string;
        image: string;
    }>();

    const [stages, setStages] = useState<Stage[]>([]);
    const [modal, setModal] = useState<ModalTarget | null>(null);
    const [error, setError] = useState("");
    const keyRef = useRef(1);
    const nextKey = () => keyRef.current++;

    const { nodes, edges } = useMemo(() => {
        const nodes: Node[] = [];
        const edges: Edge[] = [];
        const columnWidth = 300;
        const rowHeight = 100;

        nodes.push({
            id: "trigger",
            position: { x: 0, y: 0 },
            data: {
                label: <div className="flex items-center gap-2 w-[180px]">
                    {selectedTrigger?.image
                        ? <img src={selectedTrigger.image} width={24} className="rounded-full" />
                        : <div className="w-6 h-6 rounded-full bg-slate-200" />}
                    <div className="text-sm font-semibold truncate">{selectedTrigger?.name ?? "Select trigger"}</div>
                </div>
            },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            draggable: false
        });

        let previousIds = ["trigger"];

        stages.forEach((stage, stageIndex) => {
            const currentIds: string[] = [];
            const count = stage.actions.length;

            stage.actions.forEach((action, actionIndex) => {
                const id = `stage-${stageIndex}-action-${action.key}`;
                currentIds.push(id);

                const item = availableActions.find(x => x.id === action.availableActionId);

                nodes.push({
                    id,
                    position: {
                        x: (stageIndex + 1) * columnWidth,
                        y: (actionIndex - (count - 1) / 2) * rowHeight
                    },
                    data: {
                        label: <div className="flex items-center gap-2 w-[180px]">
                            {item?.image
                                ? <img src={item.image} width={24} className="rounded-full" />
                                : <div className="w-6 h-6 rounded-full bg-slate-200" />}
                            <div className="text-sm font-semibold truncate">{action.availableActionName || "Select action"}</div>
                            <button className="ml-auto text-gray-400 hover:text-red-600" onClick={(e) => {
                                e.stopPropagation();
                                removeAction(stageIndex, actionIndex);
                            }}>✕</button>
                        </div>
                    },
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left,
                    draggable: false
                });
            });

            previousIds.forEach(source => currentIds.forEach(target => {
                edges.push({
                    id: `${source}->${target}`,
                    source,
                    target,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { strokeWidth: 2 }
                });
            }));

            previousIds = currentIds;
        });

        return { nodes, edges };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stages, selectedTrigger, availableActions]);

    function removeAction(stageIndex: number, actionIndex: number) {
        setStages(prev => prev
            .map((stage, si) => si !== stageIndex
                ? stage
                : { ...stage, actions: stage.actions.filter((_, ai) => ai !== actionIndex) })
            .filter(stage => stage.actions.length > 0)
        );
    }

    function onSelect(props: null | { name: string, id: string, metadata: any }) {
        const target = modal;
        setModal(null);

        if (!props || !target) {
            return;
        }

        const image = [...availableTriggers, ...availableActions].find(x => x.id === props.id)?.image ?? "";

        if (target.kind === "trigger") {
            setSelectedTrigger({
                id: props.id,
                name: props.name,
                image
            });
            return;
        }

        setStages(prev => {
            const next = prev.map(stage => ({ ...stage, actions: [...stage.actions] }));

            if (target.stageIndex >= next.length) {
                next.push({ key: nextKey(), actions: [] });
            }

            const action: SelectedAction = {
                key: nextKey(),
                availableActionId: props.id,
                availableActionName: props.name,
                metadata: props.metadata
            };

            if (target.actionIndex < 0) {
                next[target.stageIndex].actions.push(action);
            } else {
                next[target.stageIndex].actions[target.actionIndex] = {
                    ...action,
                    key: next[target.stageIndex].actions[target.actionIndex].key
                };
            }

            return next;
        });
    }

    async function publish() {
        if (!selectedTrigger?.id) {
            setError("Please select a trigger");
            return;
        }

        if (stages.length === 0) {
            setError("Please add at least one action");
            return;
        }

        if (stages.some(stage => stage.actions.some(a => !a.availableActionId))) {
            setError("Every action needs to be configured");
            return;
        }

        try {
            await axios.post(`${BACKEND_URL}/api/v1/zap`, {
                availableTriggerId: selectedTrigger.id,
                triggerMetadata: {},
                actions: stages.flatMap((stage, sortingOrder) => stage.actions.map(a => ({
                    availableActionId: a.availableActionId,
                    actionMetadata: a.metadata ?? {},
                    sortingOrder
                })))
            }, {
                headers: {
                    Authorization: localStorage.getItem("token")
                }
            });

            router.push("/dashboard");
        } catch (e: any) {
            setError(e.response?.data?.message ?? "Could not publish the zap");
        }
    }

    return <div>
        <Appbar />
        <div className="flex justify-end items-center gap-4 bg-slate-200 p-4">
            {error && <div className="text-red-600">{error}</div>}
            <PrimaryButton onClick={publish}>Publish</PrimaryButton>
        </div>
        <div className="w-full bg-slate-200">
            <div style={{ width: "100%", height: 520 }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                    onNodeClick={(_, node) => {
                        if (node.id === "trigger") {
                            setModal({ kind: "trigger" });
                            return;
                        }

                        stages.forEach((stage, stageIndex) => {
                            stage.actions.forEach((action, actionIndex) => {
                                if (node.id === `stage-${stageIndex}-action-${action.key}`) {
                                    setModal({ kind: "action", stageIndex, actionIndex });
                                }
                            });
                        });
                    }}
                >
                    <Background />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
            <div className="flex flex-wrap gap-3 justify-center pb-6">
                <SecondaryButton onClick={() => setModal({ kind: "action", stageIndex: stages.length, actionIndex: -1 })}>
                    + Add step
                </SecondaryButton>
                {stages.map((stage, stageIndex) => <SecondaryButton key={stage.key} onClick={() => setModal({
                    kind: "action",
                    stageIndex,
                    actionIndex: -1
                })}>
                    + Parallel action in step {stageIndex + 1}
                </SecondaryButton>)}
            </div>
        </div>
        {modal && <Modal
            availableItems={modal.kind === "trigger" ? availableTriggers : availableActions}
            isTrigger={modal.kind === "trigger"}
            onSelect={onSelect}
        />}
    </div>
}

function Modal({ onSelect, availableItems, isTrigger }: {
    onSelect: (props: null | { name: string, id: string, metadata: any }) => void,
    availableItems: AvailableItem[],
    isTrigger: boolean
}) {
    const [step, setStep] = useState(0);
    const [selectedAction, setSelectedAction] = useState<{
        id: string;
        name: string;
    }>();

    return <div className="fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full bg-slate-100 bg-opacity-70 flex">
        <div className="relative p-4 w-full max-w-2xl max-h-full">
            <div className="relative bg-white rounded-lg shadow ">
                <div className="flex items-center justify-between p-4 md:p-5 border-b rounded-t ">
                    <div className="text-xl">
                        Select {isTrigger ? "Trigger" : "Action"}
                    </div>
                    <button onClick={() => {
                        onSelect(null);
                    }} type="button" className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ms-auto inline-flex justify-center items-center" data-modal-hide="default-modal">
                        <svg className="w-3 h-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
                            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
                        </svg>
                        <span className="sr-only">Close modal</span>
                    </button>
                </div>
                <div className="p-4 md:p-5 space-y-4">
                    {step === 1 && selectedAction?.id === "email" && <EmailSelector setMetadata={(metadata) => {
                        onSelect({
                            ...selectedAction,
                            metadata
                        })
                    }} />}

                    {(step === 1 && selectedAction?.id === "send-sol") && <SolanaSelector setMetadata={(metadata) => {
                        onSelect({
                            ...selectedAction,
                            metadata
                        })
                    }} />}

                    {step === 0 && <div>{availableItems.map(({id, name, image}) => {
                            return <div key={id} onClick={() => {
                                if (isTrigger) {
                                    onSelect({
                                        id,
                                        name,
                                        metadata: {}
                                    })
                                } else {
                                    setStep(s => s + 1);
                                    setSelectedAction({
                                        id,
                                        name
                                    })
                                }
                            }} className="flex border p-4 cursor-pointer hover:bg-slate-100">
                                <img src={image} width={30} className="rounded-full" /> <div className="flex flex-col justify-center"> {name} </div>
                            </div>
                        })}</div>}
                </div>
            </div>
        </div>
    </div>

}

function EmailSelector({setMetadata}: {
    setMetadata: (params: any) => void;
}) {
    const [email, setEmail] = useState("");
    const [body, setBody] = useState("");

    return <div>
        <Input label={"To"} type={"text"} placeholder="To" onChange={(e) => setEmail(e.target.value)}></Input>
        <Input label={"Body"} type={"text"} placeholder="Body" onChange={(e) => setBody(e.target.value)}></Input>
        <div className="pt-2">
            <PrimaryButton onClick={() => {
                setMetadata({
                    email,
                    body
                })
            }}>Submit</PrimaryButton>
        </div>
    </div>
}

function SolanaSelector({setMetadata}: {
    setMetadata: (params: any) => void;
}) {
    const [amount, setAmount] = useState("");
    const [address, setAddress] = useState("");    

    return <div>
        <Input label={"To"} type={"text"} placeholder="To" onChange={(e) => setAddress(e.target.value)}></Input>
        <Input label={"Amount"} type={"text"} placeholder="To" onChange={(e) => setAmount(e.target.value)}></Input>
        <div className="pt-4">
        <PrimaryButton onClick={() => {
            setMetadata({
                amount,
                address
            })
        }}>Submit</PrimaryButton>
        </div>
    </div>
}
