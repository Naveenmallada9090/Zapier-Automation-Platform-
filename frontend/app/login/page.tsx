"use client";
import { Appbar } from "@/components/Appbar";
import { CheckFeature } from "@/components/CheckFeature";
import { DevEmailLink } from "@/components/DevEmailLink";
import { Input } from "@/components/Input";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { SecondaryButton } from "@/components/buttons/SecondaryButton";
import axios from "axios";
import { useState } from "react";
import { BACKEND_URL } from "../config";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [needsVerification, setNeedsVerification] = useState(false);
    const [resent, setResent] = useState(false);
    const [verificationLink, setVerificationLink] = useState<string>();
    const router = useRouter();
    
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
                    <Input onChange={e => {
                        setEmail(e.target.value)
                    }} label={"Email"} type="text" placeholder="Your Email"></Input>
                    <Input onChange={e => {
                        setPassword(e.target.value);
                    }} label={"Password"} type="password" placeholder="Password"></Input>

                    {error && <div className="pt-4 text-red-600">
                        {error}
                    </div>}

                    {needsVerification && <div className="pt-2">
                        {resent ? <div className="text-green-700">
                            A new verification email has been sent
                        </div> : <SecondaryButton onClick={async () => {
                            const res = await axios.post(`${BACKEND_URL}/api/v1/user/resend-verification`, {
                                username: email
                            });
                            setVerificationLink(res.data.verificationLink);
                            setResent(true);
                        }}>Resend verification email</SecondaryButton>}
                    </div>}

                    <DevEmailLink link={verificationLink} label="Verify my email" />

                    <div className="pt-4">
                        <PrimaryButton onClick={async () => {
                            try {
                                const res = await axios.post(`${BACKEND_URL}/api/v1/user/signin`, {
                                    username: email,
                                    password,
                                });
                                localStorage.setItem("token", res.data.token);
                                router.push("/dashboard");
                            } catch (e: any) {
                                const message = e.response?.data?.message ?? "Could not log you in";
                                setError(message);
                                setNeedsVerification(message.toLowerCase().includes("verify"));
                            }
                        }} size="big">Login</PrimaryButton>
                    </div>

                    <div className="pt-4 text-sm">
                        <Link className="underline" href="/forgot-password">Forgot your password?</Link>
                    </div>
                </div>
            </div>
        </div>
    </div>
}
