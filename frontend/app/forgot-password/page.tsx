"use client";
import { Appbar } from "@/components/Appbar";
import { CheckFeature } from "@/components/CheckFeature";
import { DevEmailLink } from "@/components/DevEmailLink";
import { Input } from "@/components/Input";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import axios from "axios";
import { useState } from "react";
import { BACKEND_URL } from "../config";
import Link from "next/link";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [resetLink, setResetLink] = useState<string>();
    const [error, setError] = useState("");

    return <div>
        <Appbar />
        <div className="flex justify-center">
            <div className="flex pt-8 max-w-4xl">
                <div className="flex-1 pt-20 px-4">
                    <div className="font-semibold text-3xl pb-4">
                    Forgot your password? It happens.
                    </div>
                    <div className="pb-6 pt-4">
                        <CheckFeature label={"We will email you a link to reset it"} />
                    </div>
                    <div className="pb-6">
                        <CheckFeature label={"The link is valid for 1 hour"} />
                    </div>
                    <CheckFeature label={"Your zaps keep running while you are away"} />
                </div>
                <div className="flex-1 pt-6 pb-6 mt-12 px-4 border rounded">
                    {sent ? <div>
                        <div className="text-xl font-semibold pb-4">
                            Check your email
                        </div>
                        <div>
                            If an account exists for <b>{email}</b>, we sent it a password reset link.
                        </div>
                        <DevEmailLink link={resetLink} label="Reset my password" />
                    </div> : <div>
                        <Input onChange={e => {
                            setEmail(e.target.value)
                        }} label={"Email"} type="text" placeholder="Your Email"></Input>

                        {error && <div className="pt-4 text-red-600">
                            {error}
                        </div>}

                        <div className="pt-4">
                            <PrimaryButton onClick={async () => {
                                try {
                                    await axios.post(`${BACKEND_URL}/api/v1/user/forgot-password`, {
                                        username: email
                                    }).then(res => {
                                        setResetLink(res.data.resetLink);
                                    });
                                    setError("");
                                    setSent(true);
                                } catch (e: any) {
                                    setError(e.response?.data?.message ?? "Could not send the reset email");
                                }
                            }} size="big">Send reset link</PrimaryButton>
                        </div>
                    </div>}

                    <div className="pt-4 text-sm">
                        <Link className="underline" href="/login">Back to login</Link>
                    </div>
                </div>
            </div>
        </div>
    </div>
}
