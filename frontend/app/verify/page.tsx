"use client";
import { Appbar } from "@/components/Appbar";
import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BACKEND_URL } from "../config";

export default function Verify() {
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        const token = new URLSearchParams(window.location.search).get("token");

        if (!token) {
            setStatus("error");
            setMessage("No verification token was found in the url");
            return;
        }

        axios.post(`${BACKEND_URL}/api/v1/user/verify`, { token })
            .then(res => {
                setStatus("success");
                setMessage(res.data.message);
            })
            .catch(e => {
                setStatus("error");
                setMessage(e.response?.data?.message ?? "Could not verify your email");
            })
    }, []);

    return <div>
        <Appbar />
        <div className="flex justify-center">
            <div className="flex pt-8 max-w-4xl">
                <div className="flex-1 pt-6 pb-6 mt-12 px-4 border rounded text-center">
                    <div className="text-2xl font-semibold pb-4">
                        Email verification
                    </div>
                    <div className="pb-6">
                        {status === "loading" ? "Verifying your email..." : message}
                    </div>
                    <Link className="underline" href="/login">
                        Go to login
                    </Link>
                </div>
            </div>
        </div>
    </div>
}
