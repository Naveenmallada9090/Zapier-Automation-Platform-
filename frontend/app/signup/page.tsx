"use client";
import { Appbar } from "@/components/Appbar";
import { CheckFeature } from "@/components/CheckFeature";
import { DevEmailLink } from "@/components/DevEmailLink";
import { Input } from "@/components/Input";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import axios from "axios";
import { useState } from "react";
import { BACKEND_URL } from "../config";

export default function() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [sent, setSent] = useState(false);
    const [verificationLink, setVerificationLink] = useState<string>();
    const [error, setError] = useState("");

    return <div> 
        <Appbar />
        <div className="flex justify-center">
            <div className="flex pt-8 max-w-4xl">
                <div className="flex-1 pt-20 px-4">
                    <div className="font-semibold text-3xl pb-4">
                    Join millions worldwide who automate their work using Zapier.
                    </div>
                    <div className="pb-6 pt-4">
                        <CheckFeature label={"Easy setup, no coding required"} />
                    </div>
                    <div className="pb-6">
                        <CheckFeature label={"Free forever for core features"} />
                    </div>
                    <CheckFeature label={"14-day trial of premium features & apps"} />

                </div>
                <div className="flex-1 pt-6 pb-6 mt-12 px-4 border rounded">
                    {sent ? <div>
                        <div className="text-xl font-semibold pb-4">
                            Check your email
                        </div>
                        <div>
                            We sent a verification link to <b>{email}</b>. Please verify your email before logging in.
                        </div>
                        <DevEmailLink link={verificationLink} label="Verify my email" />
                    </div> : <div>
                        <Input label={"Name"} onChange={e => {
                            setName(e.target.value)
                        }} type="text" placeholder="Your name"></Input>
                        <Input onChange={e => {
                            setEmail(e.target.value)
                        }} label={"Email"} type="text" placeholder="Your Email"></Input>
                        <Input onChange={e => {
                            setPassword(e.target.value)
                        }} label={"Password"} type="password" placeholder="Password"></Input>

                        {error && <div className="pt-4 text-red-600">
                            {error}
                        </div>}

                        <div className="pt-4">
                            <PrimaryButton onClick={async () => {
                                try {
                                    await axios.post(`${BACKEND_URL}/api/v1/user/signup`, {
                                        username: email,
                                        password,
                                        name
                                    }).then(res => {
                                        setVerificationLink(res.data.verificationLink);
                                    });
                                    setError("");
                                    setSent(true);
                                } catch (e: any) {
                                    setError(e.response?.data?.message ?? "Could not sign you up");
                                }
                            }} size="big">Get started free</PrimaryButton>
                        </div>
                    </div>}
                </div>
            </div>
        </div>
    </div>
}
