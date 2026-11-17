"use client";
import { Appbar } from "@/components/Appbar";
import { CheckFeature } from "@/components/CheckFeature";
import { Input } from "@/components/Input";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BACKEND_URL } from "../config";

export default function() {
    const [token, setToken] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);

    useEffect(() => {
        setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    }, []);

    return <div>
        <Appbar />
        <div className="flex justify-center">
            <div className="flex pt-8 max-w-4xl">
                <div className="flex-1 pt-20 px-4">
                    <div className="font-semibold text-3xl pb-4">
                    Choose a new password.
                    </div>
                    <div className="pb-6 pt-4">
                        <CheckFeature label={"Pick something you have not used before"} />
                    </div>
                    <div className="pb-6">
                        <CheckFeature label={"You will be able to login right after"} />
                    </div>
                    <CheckFeature label={"Anyone with the old password loses access"} />
                </div>
                <div className="flex-1 pt-6 pb-6 mt-12 px-4 border rounded">
                    {done ? <div>
                        <div className="text-xl font-semibold pb-4">
                            Password updated
                        </div>
                        <div className="pb-4">
                            Your password has been changed, you can login with it now.
                        </div>
                        <Link className="underline" href="/login">Go to login</Link>
                    </div> : <div>
                        <Input onChange={e => {
                            setPassword(e.target.value)
                        }} label={"New password"} type="password" placeholder="New password"></Input>
                        <Input onChange={e => {
                            setConfirmPassword(e.target.value)
                        }} label={"Confirm password"} type="password" placeholder="Repeat the password"></Input>

                        {error && <div className="pt-4 text-red-600">
                            {error}
                        </div>}

                        <div className="pt-4">
                            <PrimaryButton onClick={async () => {
                                if (!token) {
                                    setError("No reset token was found in the url");
                                    return;
                                }

                                if (password !== confirmPassword) {
                                    setError("Both passwords should be the same");
                                    return;
                                }

                                try {
                                    await axios.post(`${BACKEND_URL}/api/v1/user/reset-password`, {
                                        token,
                                        password
                                    });
                                    setError("");
                                    setDone(true);
                                } catch (e: any) {
                                    setError(e.response?.data?.message ?? "Could not reset your password");
                                }
                            }} size="big">Update password</PrimaryButton>
                        </div>
                    </div>}
                </div>
            </div>
        </div>
    </div>
}
